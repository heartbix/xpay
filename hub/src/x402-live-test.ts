import { DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, web3 } from '@alephium/web3'
import { PrivateKeyWallet, deriveHDWalletPrivateKeyForGroup } from '@alephium/web3-wallet'
import { PaymentVault } from 'my-contracts'
import { v4 as uuidv4 } from 'uuid'
import { pushOpsEvent } from './ops-events'
import { creditVaultFromHub, readVaultBalance, withHubSigner } from './alph-x402'
import { quoteX402Fee } from './fees'
import {
  availableBalanceAtomic,
  createEmailUser,
  drainX402ChainQueue,
  ensureUserAlphAddress,
  findMerchantByUserAndSlug,
  findUserByEmail,
  forgetX402SignNonce,
  getX402ChainReceipt,
  grantCreditedUsdt,
  updateUser,
  upsertMerchant
} from './store'

const PAY_HOST = process.env.XPAY_INTERNAL_URL ?? process.env.XPAY_PUBLIC_URL ?? 'http://127.0.0.1:3000'
const HUB_HOST = process.env.HUB_INTERNAL_URL ?? 'http://127.0.0.1:43142'
const SLUG = process.env.X402_E2E_SLUG ?? 'demo'
const PRICE_ATOMIC = process.env.X402_E2E_PRICE_ATOMIC ?? '1000'
const BUYER_EMAIL = 'bourmatt@gmail.com'
const SELLER_EMAIL = 'admin@heartbix.com'
const MIN_HUB_ATOMIC = 20_000n

let liveRunning = false
let volumeRunning = false

function alphMnemonic(): string {
  const m = process.env.HUB_ALPH_MNEMONIC?.trim() || process.env.HUB_MNEMONIC?.trim()
  if (!m) throw new Error('HUB_MNEMONIC missing')
  return m
}

function walletFrom(mnemonic: string, fromIndex: number): PrivateKeyWallet {
  const [privateKey] = deriveHDWalletPrivateKeyForGroup(mnemonic, 0, 'default', fromIndex)
  return new PrivateKeyWallet({ privateKey })
}

function walletForAddress(address: string, storedIndex: number): PrivateKeyWallet {
  const hub = alphMnemonic()
  const atStored = walletFrom(hub, storedIndex)
  if (atStored.address === address) return atStored
  for (let i = 0; i < 40; i++) {
    const w = walletFrom(hub, i)
    if (w.address === address) return w
  }
  throw new Error(`buyer HD mismatch for ${address}`)
}

function nodeUrl(): string {
  return (
    process.env.ALEPHIUM_NODE_URL ??
    (process.env.ALEPHIUM_NETWORK === 'mainnet'
      ? 'https://node.mainnet.alephium.org'
      : 'https://node.testnet.alephium.org')
  )
}

async function alphBalance(address: string): Promise<bigint> {
  const bal = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(address)
  return BigInt(bal.balance)
}

function note(
  flowId: string,
  status: string,
  title: string,
  detail: string,
  extra?: { txId?: string }
) {
  pushOpsEvent({
    kind: 'x402',
    simulated: false,
    flowId,
    status,
    title,
    detail,
    txId: extra?.txId
  })
}

export function startRealX402Test(): { flowId: string; live: true; buyer: string; seller: string } {
  if (liveRunning) throw new Error('x402_live_in_progress')
  liveRunning = true
  const flowId = uuidv4()
  void runBourmattPaysAdminSafe(flowId).finally(() => {
    liveRunning = false
  })
  return { flowId, live: true, buyer: BUYER_EMAIL, seller: SELLER_EMAIL }
}

export async function runBourmattPaysAdmin(flowId: string): Promise<{ payUrl: string; txId?: string }> {
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  web3.setCurrentNodeProvider(nodeUrl())
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: {
        PaymentVault: { contractInstance: { address: string } }
        MockUSDT: { contractInstance: { contractId: string } }
      }
    }
  }
  const deployments = loadDeployments(network)
  const vault = PaymentVault.at(deployments.contracts.PaymentVault.contractInstance.address)

  const seller = findUserByEmail(SELLER_EMAIL)
  const buyer = findUserByEmail(BUYER_EMAIL)
  if (!seller?.alphAddress) throw new Error('admin account missing alph address')
  if (!buyer?.alphAddress) throw new Error('bourmatt account missing alph address')
  if (buyer.alphDerivationIndex == null) throw new Error('bourmatt alphDerivationIndex missing')

  if (!seller.emailVerifiedAt) {
    updateUser(seller.userId, { emailVerifiedAt: new Date().toISOString() })
  }

  note(
    flowId,
    'seller_api',
    'Seller creates endpoint',
    `${SELLER_EMAIL} POST /api/merchants slug=${SLUG} price=${PRICE_ATOMIC} atomic`
  )

  const existing = findMerchantByUserAndSlug(seller.userId, SLUG)
  const now = new Date().toISOString()
  const merchant = upsertMerchant({
    id: existing?.id ?? uuidv4(),
    userId: seller.userId,
    slug: SLUG,
    payTo: seller.alphAddress,
    priceAtomic: PRICE_ATOMIC,
    description: 'HeartBix X402 live test (admin)',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })
  const payUrl = `${PAY_HOST}/api/pay/${encodeURIComponent(merchant.payTo)}/${encodeURIComponent(merchant.slug)}`
  note(flowId, 'pay_url', 'Pay URL ready', `${SELLER_EMAIL} shares ${payUrl} with ${BUYER_EMAIL}`)

  const buyerWallet = walletForAddress(buyer.alphAddress, buyer.alphDerivationIndex)
  const hubKey = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!hubKey) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  const hubWallet = new PrivateKeyWallet({ privateKey: hubKey })

  const hasKey = (await vault.view.hasPublicKey({ args: { user: buyer.alphAddress } })).returns
  const buyerAlph = await alphBalance(buyer.alphAddress)
  if (!hasKey && buyerAlph < MINIMAL_CONTRACT_DEPOSIT + DUST_AMOUNT * 20n) {
    note(flowId, 'fund_alph', 'Sponsoring buyer ALPH', `${BUYER_EMAIL} needs ALPH to register the vault key`)
    const send = MINIMAL_CONTRACT_DEPOSIT + DUST_AMOUNT * 50n
    const funded = await withHubSigner(() =>
      hubWallet.signAndSubmitTransferTx({
        signerAddress: hubWallet.address,
        destinations: [{ address: buyer.alphAddress!, attoAlphAmount: send }]
      })
    )
    note(flowId, 'fund_alph', 'ALPH sent', `Buyer funded for registerPublicKey`, { txId: funded.txId })
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      if ((await alphBalance(buyer.alphAddress)) >= send) break
    }
  }

  if (!hasKey) {
    note(flowId, 'register', 'Register vault key', `${BUYER_EMAIL} registerPublicKey on PaymentVault`)
    const registered = await vault.transact.registerPublicKey({
      signer: buyerWallet,
      args: { publicKey: buyerWallet.publicKey },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })
    note(flowId, 'register', 'Vault key registered', 'Buyer can sign x402 payments', { txId: registered.txId })
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const ok = (await vault.view.hasPublicKey({ args: { user: buyer.alphAddress } })).returns
      if (ok) break
    }
  }

  const hubBal = availableBalanceAtomic(buyer.userId)
  if (hubBal < MIN_HUB_ATOMIC) {
    throw new Error(`buyer_hub_too_low need ${MIN_HUB_ATOMIC.toString()} have ${hubBal.toString()}`)
  }
  const nonce = (await vault.view.getNonce({ args: { user: buyer.alphAddress } })).returns
  note(
    flowId,
    'http_402',
    'Buyer hits URL',
    `${BUYER_EMAIL} GET ${payUrl} (expect HTTP 402)`
  )
  const challenge = await fetch(payUrl, { headers: { accept: 'application/json' } })
  const challengeBody = await challenge.json()
  if (challenge.status !== 402) {
    throw new Error(`expected 402 got ${challenge.status}`)
  }
  note(
    flowId,
    'http_402',
    'HTTP 402 received',
    `Amount ${challengeBody.accepts?.[0]?.maxAmountRequired ?? '?'} atomic · payTo ${merchant.payTo}`
  )

  const requirements = challengeBody.accepts[0]
  const amount = BigInt(requirements.maxAmountRequired)
  if (hubBal < amount) {
    throw new Error(`buyer_hub_too_low need ${amount.toString()} have ${hubBal.toString()}`)
  }
  const deadline = BigInt(Date.now()) + BigInt(requirements.maxTimeoutSeconds) * 1000n
  const hash = (
    await vault.view.paymentHash({
      args: {
        from: buyer.alphAddress,
        to: requirements.payTo,
        amount,
        nonce,
        deadline
      }
    })
  ).returns
  note(flowId, 'signed', 'Buyer signs payment', `${BUYER_EMAIL} signs PaymentVault hash, retries with PAYMENT-SIGNATURE`)
  const signature = await buyerWallet.signRaw(buyer.alphAddress, hash)
  const payload = {
    scheme: 'exact',
    network: requirements.network,
    payload: {
      from: buyer.alphAddress,
      to: requirements.payTo,
      amount: amount.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature
    }
  }
  const header = Buffer.from(JSON.stringify(payload)).toString('base64')
  note(flowId, 'settling', 'On-chain settle', 'Signature verified; submitting PaymentVault.settle (MUSDT transfer)')
  const paid = await fetch(payUrl, {
    headers: {
      accept: 'application/json',
      'PAYMENT-SIGNATURE': header
    }
  })
  const paidBody = await paid.json()
  if (!paid.ok) {
    throw new Error(paidBody?.error ?? `pay_failed_${paid.status}`)
  }
  const txId = String(paidBody.txId ?? '')
  note(
    flowId,
    'recorded',
    'X402 settled',
    `${BUYER_EMAIL} → ${SELLER_EMAIL} · ${amount.toString()} atomic · History sent/received`,
    { txId }
  )
  return { payUrl, txId }
}

export async function runBourmattPaysAdminSafe(flowId: string): Promise<void> {
  try {
    await runBourmattPaysAdmin(flowId)
  } catch (e: any) {
    note(flowId, 'failed', 'X402 live test failed', e?.message ?? String(e))
  }
}

function usdtToAtomic(value: string): string {
  const n = Number(value)
  return String(BigInt(Math.round(n * 1_000_000)))
}

function formatAtomicUsdt(atomic: string | bigint): string {
  const n = BigInt(atomic)
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

/** Inclusive 0.001–0.005 USDT (1000–5000 atomic). */
function randomCatalogAtomic(): string {
  return String(1000 + Math.floor(Math.random() * 4001))
}

/** Random catalog prices that sum exactly to `total` atomic, each at least 0.001 USDT. */
function splitTotalAtomic(total: bigint, count: number, min = 1000n): string[] {
  if (count <= 0) throw new Error('burst_count_invalid')
  const floor = min * BigInt(count)
  if (total < floor) throw new Error('volume_total_too_small')
  const extra = total - floor
  const weights = Array.from({ length: count }, () => Math.random() + 0.05)
  const wsum = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((w) => min + BigInt(Math.floor((w / wsum) * Number(extra))))
  let acc = parts.reduce((a, b) => a + b, 0n)
  for (let i = 0; acc < total; i++) {
    parts[i % count] += 1n
    acc += 1n
  }
  for (let i = 0; acc > total && i < count * 4; i++) {
    const j = parts.findIndex((p) => p > min)
    if (j < 0) break
    parts[j] -= 1n
    acc -= 1n
  }
  return parts.map(String)
}

export type DirectedBurstResult = {
  buyer: string
  seller: string
  payUrl: string
  pays: { amountUsdt: string; totalAtomic: string; txId: string; ms: number }[]
  totalMs: number
  totalAtomic: string
}

export async function runDirectedBurst(opts: {
  flowId: string
  buyerEmail: string
  sellerEmail: string
  slug: string
  count: number
  totalAtomic?: string
}): Promise<DirectedBurstResult> {
  const { flowId, buyerEmail, sellerEmail, slug, count, totalAtomic: totalOpt } = opts
  if (count <= 0) throw new Error('burst_count_invalid')
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  web3.setCurrentNodeProvider(nodeUrl())
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: { PaymentVault: { contractInstance: { address: string } } }
    }
  }
  const vault = PaymentVault.at(loadDeployments(network).contracts.PaymentVault.contractInstance.address)
  const seller = findUserByEmail(sellerEmail)
  const buyer = findUserByEmail(buyerEmail)
  if (!seller?.alphAddress) throw new Error(`seller_missing ${sellerEmail}`)
  if (!buyer?.alphAddress) throw new Error(`buyer_missing ${buyerEmail}`)
  if (buyer.userId === seller.userId) throw new Error('self_pay')
  if (!seller.emailVerifiedAt) {
    updateUser(seller.userId, { emailVerifiedAt: new Date().toISOString() })
  }
  console.log(`[x402-volume] ${buyerEmail} → ${sellerEmail} slug=${slug} count=${count}`)
  const buyerWallet = walletForAddress(buyer.alphAddress, buyer.alphDerivationIndex ?? 0)
  await ensureVaultKey(vault, flowId, buyerEmail, buyer.alphAddress, buyerWallet)
  const fee = await withTimeout(quoteX402Fee(), 15000, 'quoteX402Fee')
  const feeAtomic = BigInt(fee.totalUsdtAtomic || '0')
  const prices = totalOpt
    ? splitTotalAtomic(BigInt(totalOpt), count)
    : Array.from({ length: count }, () => randomCatalogAtomic())
  const need = prices.reduce((n, p) => n + BigInt(p) + feeAtomic, 0n)
  const hubBal = availableBalanceAtomic(buyer.userId)
  if (hubBal < need) {
    throw new Error(
      `buyer_hub_too_low ${buyerEmail} need ${formatAtomicUsdt(need)} have ${formatAtomicUsdt(hubBal)}`
    )
  }
  await ensureVaultMusdt(flowId, buyerEmail, buyer.alphAddress, need)
  const existing = findMerchantByUserAndSlug(seller.userId, slug)
  const now = new Date().toISOString()
  const merchant = upsertMerchant({
    id: existing?.id ?? uuidv4(),
    userId: seller.userId,
    slug,
    payTo: seller.alphAddress,
    priceAtomic: prices[0],
    description: `HeartBix X402 volume ${slug}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })
  const payUrl = `${PAY_HOST}/api/pay/${encodeURIComponent(merchant.payTo)}/${encodeURIComponent(merchant.slug)}`
  const pays: DirectedBurstResult['pays'] = []
  const t0 = Date.now()
  note(
    flowId,
    'burst',
    `Burst ${buyerEmail} → ${sellerEmail}`,
    `${count} pays · need ${formatAtomicUsdt(need)} USDT`
  )

  for (let i = 0; i < prices.length; i++) {
    const priceAtomic = prices[i]
    upsertMerchant({
      ...merchant,
      priceAtomic,
      updatedAt: new Date().toISOString()
    })
    const intentRes = await fetchJson(
      `${HUB_HOST}/api/x402/intent?from=${encodeURIComponent(buyer.alphAddress)}`
    )
    const intent = intentRes.body as { nonce: string; error?: string }
    if (!intent.nonce) throw new Error(intent.error ?? 'intent_failed')
    const nonce = BigInt(intent.nonce)
    const started = Date.now()
    const challenge = await fetchJson(payUrl, { headers: { accept: 'application/json' } })
    const challengeBody = challenge.body
    if (challenge.status !== 402) throw new Error(`expected 402 got ${challenge.status}`)
    const requirements = challengeBody.accepts[0]
    const amount = BigInt(requirements.maxAmountRequired)
    const deadline = BigInt(Date.now()) + BigInt(requirements.maxTimeoutSeconds) * 1000n
    const hash = (
      await withTimeout(
        vault.view.paymentHash({
          args: {
            from: buyer.alphAddress,
            to: requirements.payTo,
            amount,
            nonce,
            deadline
          }
        }),
        20000,
        'paymentHash'
      )
    ).returns
    const signature = await buyerWallet.signRaw(buyer.alphAddress, hash)
    const payload = {
      scheme: 'exact',
      network: requirements.network,
      payload: {
        from: buyer.alphAddress,
        to: requirements.payTo,
        amount: amount.toString(),
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature
      }
    }
    const paid = await fetchJson(payUrl, {
      headers: {
        accept: 'application/json',
        'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(payload)).toString('base64')
      }
    })
    const paidBody = paid.body
    if (paid.status < 200 || paid.status >= 300) {
      throw new Error(paidBody?.error ?? `pay_failed_${paid.status}`)
    }
    const ms = Date.now() - started
    const txId = String(paidBody.txId ?? '')
    await waitChainReceipt(txId)
    const amountUsdt = formatAtomicUsdt(priceAtomic)
    pays.push({ amountUsdt, totalAtomic: amount.toString(), txId, ms })
    if (i === 0 || i === prices.length - 1 || (i + 1) % 10 === 0) {
      note(
        flowId,
        'recorded',
        `Burst ${i + 1}/${prices.length}`,
        `${buyerEmail} → ${sellerEmail} · ${amountUsdt} USDT · ${ms}ms`,
        { txId }
      )
    }
  }

  const totalAtomic = pays.reduce((n, p) => n + BigInt(p.totalAtomic), 0n).toString()
  const totalMs = Date.now() - t0
  note(
    flowId,
    'burst_done',
    `Burst complete ${buyerEmail} → ${sellerEmail}`,
    `${pays.length} pays in ${totalMs}ms · ${formatAtomicUsdt(totalAtomic)} USDT`
  )
  return { buyer: buyerEmail, seller: sellerEmail, payUrl, pays, totalMs, totalAtomic }
}

export async function runX402Burst(flowId: string): Promise<DirectedBurstResult> {
  const n = Number(process.env.X402_BURST_COUNT ?? '10')
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 10
  return runDirectedBurst({
    flowId,
    buyerEmail: BUYER_EMAIL,
    sellerEmail: SELLER_EMAIL,
    slug: 'burst',
    count
  })
}

export type VolumeFillOpts = {
  count?: number
  totalAtomic?: string
  bourmattFirst?: boolean
}

export async function runVolumeFill(opts: number | VolumeFillOpts = 100): Promise<{
  adminToBourmatt: DirectedBurstResult
  bourmattToAdmin: DirectedBurstResult
}> {
  const parsed: VolumeFillOpts = typeof opts === 'number' ? { count: opts } : opts
  const count = parsed.count && parsed.count > 0 ? parsed.count : 100
  const totalAtomic = parsed.totalAtomic
  const drained = drainX402ChainQueue('volume_preclear')
  if (drained > 0) {
    console.log(`[x402-volume] drained ${drained} stuck settle jobs`)
  }
  const adminToBourmattArgs = {
    flowId: uuidv4(),
    buyerEmail: SELLER_EMAIL,
    sellerEmail: BUYER_EMAIL,
    slug: 'volume-in',
    count,
    totalAtomic
  }
  const bourmattToAdminArgs = {
    flowId: uuidv4(),
    buyerEmail: BUYER_EMAIL,
    sellerEmail: SELLER_EMAIL,
    slug: 'volume-out',
    count,
    totalAtomic
  }
  if (parsed.bourmattFirst) {
    const bourmattToAdmin = await runDirectedBurst(bourmattToAdminArgs)
    const adminToBourmatt = await runDirectedBurst(adminToBourmattArgs)
    return { adminToBourmatt, bourmattToAdmin }
  }
  const adminToBourmatt = await runDirectedBurst(adminToBourmattArgs)
  const bourmattToAdmin = await runDirectedBurst(bourmattToAdminArgs)
  return { adminToBourmatt, bourmattToAdmin }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new Error(`${label}_timeout`)), ms)
      })
    ])
  } finally {
    if (t) clearTimeout(t)
  }
}

async function waitChainReceipt(txId: string, maxMs = 300_000): Promise<void> {
  if (!txId) throw new Error('missing_txId')
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const row = getX402ChainReceipt(txId)
    if (row?.chainStatus === 'settled') return
    if (row?.chainStatus === 'failed') {
      throw new Error(row.chainError || 'receipt_failed')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`receipt_timeout ${txId}`)
}

async function ensureVaultMusdt(
  flowId: string,
  email: string,
  address: string,
  need: bigint
): Promise<void> {
  const have = await withTimeout(readVaultBalance(address), 20000, 'vaultBalance')
  if (have >= need) return
  const topUp = need - have
  console.log(`[x402-volume] creditFromHub ${email} ${formatAtomicUsdt(topUp)} MUSDT`)
  note(
    flowId,
    'fund_musdt',
    'Top up PaymentVault MUSDT',
    `${email} vault ${formatAtomicUsdt(have)} need ${formatAtomicUsdt(need)}`
  )
  const funded = await creditVaultFromHub(address, topUp)
  note(flowId, 'fund_musdt', 'Vault MUSDT credited', `${email} +${formatAtomicUsdt(topUp)}`, {
    txId: funded.txId
  })
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    if ((await readVaultBalance(address)) >= need) return
  }
  throw new Error(`buyer_vault_musdt_low ${email} have ${have.toString()} need ${need.toString()}`)
}

async function ensureVaultKey(
  vault: ReturnType<typeof PaymentVault.at>,
  flowId: string,
  email: string,
  address: string,
  wallet: PrivateKeyWallet
): Promise<void> {
  const hasKey = (
    await withTimeout(vault.view.hasPublicKey({ args: { user: address } }), 20000, 'hasPublicKey')
  ).returns
  if (hasKey) return
  const hubKey = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!hubKey) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  const hubWallet = new PrivateKeyWallet({ privateKey: hubKey })
  const buyerAlph = await alphBalance(address)
  const needAlph = MINIMAL_CONTRACT_DEPOSIT * 2n + DUST_AMOUNT * 200n
  if (buyerAlph < needAlph) {
    const send = needAlph + DUST_AMOUNT * 50n
    console.log(`[x402-volume] funding ALPH for ${email}`)
    note(flowId, 'fund_alph', 'Sponsoring buyer ALPH', `${email} needs ALPH to register the vault key`)
    const funded = await withHubSigner(() =>
      hubWallet.signAndSubmitTransferTx({
        signerAddress: hubWallet.address,
        destinations: [{ address, attoAlphAmount: send }]
      })
    )
    note(flowId, 'fund_alph', 'ALPH sent', `Buyer funded for registerPublicKey`, { txId: funded.txId })
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      if ((await alphBalance(address)) >= send) break
    }
  }
  console.log(`[x402-volume] registerPublicKey ${email}`)
  note(flowId, 'register', 'Register vault key', `${email} registerPublicKey on PaymentVault`)
  const registered = await vault.transact.registerPublicKey({
    signer: wallet,
    args: { publicKey: wallet.publicKey },
    attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
  })
  note(flowId, 'register', 'Vault key registered', `${email} can sign x402 payments`, { txId: registered.txId })
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const ok = (await vault.view.hasPublicKey({ args: { user: address } })).returns
    if (ok) return
  }
  throw new Error(`buyer_vault_key_missing ${email}`)
}

async function fetchJson(url: string, init: RequestInit = {}, ms = 20000): Promise<{ status: number; body: any }> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  } finally {
    clearTimeout(t)
  }
}

function crowdEmail(n: number): string {
  return `crowd${n}@xpay.test`
}

function ensureCrowdUser(n: number) {
  const email = crowdEmail(n)
  const existing = findUserByEmail(email)
  if (existing) {
    if (!existing.emailVerifiedAt) {
      updateUser(existing.userId, { emailVerifiedAt: new Date().toISOString() })
    }
    return ensureUserAlphAddress(existing.userId)
  }
  const user = createEmailUser({
    userId: uuidv4(),
    email,
    emailVerifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  })
  return ensureUserAlphAddress(user.userId)
}

export async function runCrowdFill(opts: {
  customers?: number
  paysEach?: number
}): Promise<{ customers: string[]; bursts: DirectedBurstResult[] }> {
  const customers = Math.min(Math.max(opts.customers ?? 8, 1), 40)
  const paysEach = Math.min(Math.max(opts.paysEach ?? 5, 1), 50)
  const flowId = uuidv4()
  console.log(`[x402-crowd] create ${customers} accounts, ${paysEach} pays each → ${SELLER_EMAIL}`)
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  web3.setCurrentNodeProvider(nodeUrl())
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: { PaymentVault: { contractInstance: { address: string } } }
    }
  }
  const vault = PaymentVault.at(loadDeployments(network).contracts.PaymentVault.contractInstance.address)
  const fee = await withTimeout(quoteX402Fee(), 15000, 'quoteX402Fee')
  const budget = BigInt(paysEach) * (5000n + BigInt(fee.totalUsdtAtomic || '0')) + 2000n
  const emails: string[] = []
  for (let i = 1; i <= customers; i++) {
    const user = ensureCrowdUser(i)
    const email = user.email || crowdEmail(i)
    emails.push(email)
    if (!user.alphAddress) throw new Error(`crowd_alph_missing ${email}`)
    forgetX402SignNonce(user.alphAddress)
    const have = availableBalanceAtomic(user.userId)
    if (have < budget) grantCreditedUsdt(user.userId, (budget - have).toString())
    const wallet = walletForAddress(user.alphAddress, user.alphDerivationIndex ?? 0)
    await ensureVaultKey(vault, flowId, email, user.alphAddress, wallet)
    await ensureVaultMusdt(flowId, email, user.alphAddress, budget)
    console.log(`[x402-crowd] account ${email} alph=${user.alphAddress}`)
  }
  const settled = await Promise.allSettled(
    emails.map((email, idx) =>
      runDirectedBurst({
        flowId,
        buyerEmail: email,
        sellerEmail: SELLER_EMAIL,
        slug: `crowd-${idx + 1}`,
        count: paysEach
      })
    )
  )
  const bursts: DirectedBurstResult[] = []
  for (const row of settled) {
    if (row.status === 'fulfilled') bursts.push(row.value)
    else console.error(`[x402-crowd] burst failed ${row.reason?.message ?? row.reason}`)
  }
  if (bursts.length === 0) throw new Error('crowd_all_bursts_failed')
  return { customers: emails, bursts }
}

let trafficTimer: ReturnType<typeof setInterval> | undefined

export function startTrafficLoop(): void {
  if (process.env.HUB_X402_TRAFFIC === '0') {
    console.log('[x402-traffic] disabled')
    return
  }
  if (trafficTimer) return
  const ms = Number(process.env.HUB_X402_TRAFFIC_MS ?? 10 * 60 * 1000)
  const interval = Number.isFinite(ms) && ms >= 60_000 ? ms : 10 * 60 * 1000
  const customers = Math.min(Math.max(Number(process.env.HUB_X402_TRAFFIC_CUSTOMERS ?? 8), 1), 8)
  const paysEach = Math.min(Math.max(Number(process.env.HUB_X402_TRAFFIC_PAYS ?? 1), 1), 5)
  console.log(`[x402-traffic] every ${interval}ms · ${customers}×${paysEach}`)
  const tick = async () => {
    if (volumeRunning || liveRunning) {
      console.log('[x402-traffic] skip busy')
      return
    }
    volumeRunning = true
    try {
      const r = await runCrowdFill({ customers, paysEach })
      const pays = r.bursts.reduce((n, b) => n + b.pays.length, 0)
      console.log(`[x402-traffic] ok accounts=${r.bursts.length} pays=${pays}`)
    } catch (e: any) {
      console.error(`[x402-traffic] failed ${e?.message ?? String(e)}`)
    } finally {
      volumeRunning = false
    }
  }
  setTimeout(() => {
    void tick()
    trafficTimer = setInterval(() => void tick(), interval)
  }, 45_000)
}

export function startCrowdFill(opts: { customers?: number; paysEach?: number } = {}): {
  flowId: string
  customers: number
  paysEach: number
} {
  if (volumeRunning || liveRunning) throw new Error('x402_volume_in_progress')
  volumeRunning = true
  const flowId = uuidv4()
  const customers = Math.min(Math.max(opts.customers ?? 8, 1), 40)
  const paysEach = Math.min(Math.max(opts.paysEach ?? 5, 1), 50)
  console.log(`[x402-crowd] start customers=${customers} paysEach=${paysEach} flow=${flowId}`)
  void runCrowdFill({ customers, paysEach })
    .then((r) => {
      const pays = r.bursts.reduce((n, b) => n + b.pays.length, 0)
      console.log(`[x402-crowd] done accounts=${r.customers.length} pays=${pays}`)
      note(flowId, 'crowd_done', 'Crowd fill complete', `${r.customers.length} accounts · ${pays} pays`)
    })
    .catch((e: any) => {
      console.error(`[x402-crowd] failed ${e?.message ?? String(e)}`)
      note(flowId, 'failed', 'Crowd fill failed', e?.message ?? String(e))
    })
    .finally(() => {
      volumeRunning = false
    })
  return { flowId, customers, paysEach }
}

export function startVolumeFill(
  count = 100,
  extra: { totalAtomic?: string; bourmattFirst?: boolean } = {}
): { flowId: string; count: number; buyerA: string; sellerA: string } {
  if (volumeRunning || liveRunning) throw new Error('x402_volume_in_progress')
  volumeRunning = true
  const flowId = uuidv4()
  console.log(
    `[x402-volume] start count=${count} total=${extra.totalAtomic ?? 'random'} bourmattFirst=${!!extra.bourmattFirst} flow=${flowId}`
  )
  void runVolumeFill({ count, ...extra })
    .then((r) => {
      console.log(
        `[x402-volume] done admin→bourmatt ${r.adminToBourmatt.pays.length} bourmatt→admin ${r.bourmattToAdmin.pays.length}`
      )
      note(
        flowId,
        'volume_done',
        'Volume fill complete',
        `admin→bourmatt ${r.adminToBourmatt.pays.length} · bourmatt→admin ${r.bourmattToAdmin.pays.length}`
      )
    })
    .catch((e: any) => {
      console.error(`[x402-volume] failed ${e?.message ?? String(e)}`)
      note(flowId, 'failed', 'Volume fill failed', e?.message ?? String(e))
    })
    .finally(() => {
      volumeRunning = false
    })
  return { flowId, count, buyerA: SELLER_EMAIL, sellerA: BUYER_EMAIL }
}
