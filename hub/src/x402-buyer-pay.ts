import { web3 } from '@alephium/web3'
import { PrivateKeyWallet, deriveHDWalletPrivateKeyForGroup } from '@alephium/web3-wallet'
import { PaymentVault } from 'my-contracts'
import { readVaultNonce } from './alph-x402'
import { readMnemonic } from './addresses'
import { availableBalanceAtomic, ensureUserAlphAddress, getUser, getX402Intent } from './store'

const PAY_HOST = process.env.XPAY_INTERNAL_URL ?? process.env.XPAY_PUBLIC_URL ?? 'http://127.0.0.1:3000'

function alphMnemonic(): string {
  const m = readMnemonic('HUB_ALPH_MNEMONIC') || readMnemonic('HUB_MNEMONIC')
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
  throw new Error('buyer HD mismatch')
}

function nodeUrl(): string {
  return (
    process.env.ALEPHIUM_NODE_URL ??
    (process.env.ALEPHIUM_NETWORK === 'mainnet'
      ? 'https://node.mainnet.alephium.org'
      : 'https://node.testnet.alephium.org')
  )
}

export function parsePayUrl(raw: string): { payTo?: string; slug: string; path: string } {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('pay_url_required')
  const href = trimmed.includes('://') ? trimmed : `https://xpay.heartbix.com/${trimmed.replace(/^\//, '')}`
  let u: URL
  try {
    u = new URL(href)
  } catch {
    throw new Error('invalid_pay_url')
  }
  const parts = u.pathname.split('/').filter(Boolean)
  const i = parts.indexOf('pay')
  if (i < 0 || !parts[i + 1]) throw new Error('invalid_pay_url')
  if (parts[i + 2]) {
    return {
      payTo: decodeURIComponent(parts[i + 1]),
      slug: decodeURIComponent(parts[i + 2]),
      path: `/api/pay/${parts[i + 1]}/${parts[i + 2]}${u.search}`
    }
  }
  return {
    slug: decodeURIComponent(parts[i + 1]),
    path: `/api/pay/${parts[i + 1]}${u.search}`
  }
}

export type PayQuote = {
  path: string
  slug: string
  payTo: string
  description: string
  network: string
  priceAtomic: string
  feeAtomic: string
  totalAtomic: string
  maxTimeoutSeconds: number
  buyerAlph: string
  balanceAtomic: string
}

async function fetchPay(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${PAY_HOST}${path}`, {
    headers: { accept: 'application/json', ...headers }
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

export async function quotePayUrl(userId: string, rawUrl: string): Promise<PayQuote> {
  const user = ensureUserAlphAddress(userId)
  if (!user.alphAddress) throw new Error('receive_account_missing')
  const parsed = parsePayUrl(rawUrl)
  const { status, body } = await fetchPay(parsed.path)
  if (status === 404) throw new Error('merchant_not_found')
  if (status !== 402) throw new Error(body?.error ?? `expected_402_got_${status}`)
  const req = body?.accepts?.[0]
  if (!req?.payTo || !req.maxAmountRequired) throw new Error('invalid_402')
  if (req.payTo === user.alphAddress) throw new Error('self_pay')
  return {
    path: parsed.path,
    slug: parsed.slug,
    payTo: req.payTo,
    description: String(req.description || ''),
    network: String(req.network || `alephium:${process.env.ALEPHIUM_NETWORK ?? 'testnet'}`),
    priceAtomic: String(req.extra?.priceAtomic || req.maxAmountRequired),
    feeAtomic: String(req.extra?.fee?.totalUsdtAtomic || '0'),
    totalAtomic: String(req.maxAmountRequired),
    maxTimeoutSeconds: Number(req.maxTimeoutSeconds || 7200),
    buyerAlph: user.alphAddress,
    balanceAtomic: availableBalanceAtomic(user.userId).toString()
  }
}

export async function payPayUrl(userId: string, rawUrl: string): Promise<{
  ok: true
  txId: string
  slug: string
  payTo: string
  payer: string
  totalAtomic: string
  priceAtomic: string
  feeAtomic: string
}> {
  const quote = await quotePayUrl(userId, rawUrl)
  const user = getUser(userId)
  if (!user?.alphAddress) throw new Error('receive_account_missing')
  if (BigInt(quote.balanceAtomic) < BigInt(quote.totalAtomic)) throw new Error('insufficient_balance')
  if (user.alphDerivationIndex == null) throw new Error('buyer HD mismatch')

  web3.setCurrentNodeProvider(nodeUrl())
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: { PaymentVault: { contractInstance: { address: string } } }
    }
  }
  const vault = PaymentVault.at(loadDeployments(network).contracts.PaymentVault.contractInstance.address)
  const wallet = walletForAddress(user.alphAddress, user.alphDerivationIndex)
  const vaultNonce = await readVaultNonce(user.alphAddress)
  const nonce = BigInt(getX402Intent(user.alphAddress, vaultNonce).nonce)
  const deadline = BigInt(Date.now()) + BigInt(quote.maxTimeoutSeconds) * 1000n
  const amount = BigInt(quote.totalAtomic)
  const hash = (
    await vault.view.paymentHash({
      args: {
        from: user.alphAddress,
        to: quote.payTo,
        amount,
        nonce,
        deadline
      }
    })
  ).returns
  const signature = await wallet.signRaw(user.alphAddress, hash)
  const payload = {
    scheme: 'exact',
    network: quote.network,
    payload: {
      from: user.alphAddress,
      to: quote.payTo,
      amount: amount.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature
    }
  }
  const header = Buffer.from(JSON.stringify(payload)).toString('base64')
  const paid = await fetchPay(quote.path, { 'PAYMENT-SIGNATURE': header })
  if (paid.status < 200 || paid.status >= 300) {
    throw new Error(paid.body?.error ?? `pay_failed_${paid.status}`)
  }
  return {
    ok: true,
    txId: String(paid.body.txId ?? ''),
    slug: quote.slug,
    payTo: quote.payTo,
    payer: user.alphAddress,
    totalAtomic: quote.totalAtomic,
    priceAtomic: quote.priceAtomic,
    feeAtomic: quote.feeAtomic
  }
}
