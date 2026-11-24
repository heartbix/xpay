import { DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { PaymentVault, SettlePayment } from 'my-contracts'

function alphNodeUrl(): string {
  return (
    process.env.ALEPHIUM_NODE_URL ??
    (process.env.ALEPHIUM_NETWORK === 'mainnet'
      ? 'https://node.mainnet.alephium.org'
      : 'https://node.testnet.alephium.org')
  )
}

function setAlphProvider() {
  web3.setCurrentNodeProvider(alphNodeUrl())
}

let hubSignerTail = Promise.resolve()

/** One hub UTXO at a time: Alephium rejects parallel submits as double-spend. */
export async function withHubSigner<T>(fn: () => Promise<T>): Promise<T> {
  const prev = hubSignerTail
  let release!: () => void
  hubSignerTail = new Promise<void>((r) => {
    release = r
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

function loadVault() {
  setAlphProvider()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: {
        PaymentVault: { contractInstance: { address: string; contractId: string } }
      }
    }
  }
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  const instance = loadDeployments(network).contracts.PaymentVault.contractInstance
  return {
    vault: PaymentVault.at(instance.address),
    vaultId: instance.contractId
  }
}

/**
 * Contract view calls to the public node take 10-20s, which blows past the
 * 20s client timeout in the x402 flow. Nonces only change when a payment
 * settles, so a short TTL cache is safe and keeps the intent endpoint fast.
 */
const NONCE_TTL_MS = 15_000
const nonceCache = new Map<string, { value: bigint; at: number }>()

export async function readVaultNonce(user: string): Promise<bigint> {
  const hit = nonceCache.get(user)
  if (hit && Date.now() - hit.at < NONCE_TTL_MS) return hit.value
  const { vault } = loadVault()
  const value = (await vault.view.getNonce({ args: { user } })).returns
  nonceCache.set(user, { value, at: Date.now() })
  return value
}

/** Drops the cached nonce so the next read hits the chain. */
export function invalidateVaultNonce(user: string): void {
  nonceCache.delete(user)
}

export async function readVaultBalance(user: string): Promise<bigint> {
  const { vault } = loadVault()
  return (await vault.view.getBalance({ args: { user } })).returns
}

export async function creditVaultFromHub(user: string, amount: bigint): Promise<{ txId: string }> {
  if (amount <= 0n) return { txId: '' }
  const privateKey = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!privateKey) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  const { vault } = loadVault()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: { MockUSDT: { contractInstance: { contractId: string } } }
    }
  }
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  const usdtId = loadDeployments(network).contracts.MockUSDT.contractInstance.contractId
  const hubWallet = new PrivateKeyWallet({ privateKey })
  return withHubSigner(async () => {
    const result = await vault.transact.creditFromHub({
      signer: hubWallet,
      args: { user, amount },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 2n + DUST_AMOUNT,
      tokens: [{ id: usdtId, amount }]
    })
    await assertScriptOk(result.txId)
    return { txId: result.txId }
  })
}

const TX_ID_RE = /^[0-9a-f]{64}$/i

export function isTxIdFormat(txId: string): boolean {
  return TX_ID_RE.test(txId.trim())
}

/**
 * Confirms a txId exists on the configured Alephium node and succeeded.
 * Used to reject fabricated receipts before they are written to the ledger.
 */
export async function verifyOnChainTx(txId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isTxIdFormat(txId)) return { ok: false, reason: 'invalid_txid' }
  setAlphProvider()
  try {
    const status = await web3.getCurrentNodeProvider().transactions.getTransactionsStatus({ txId })
    if (status.type === 'MemPooled') return { ok: true }
    if (status.type === 'Confirmed') return { ok: true }
    return { ok: false, reason: 'tx_not_confirmed' }
  } catch {
    return { ok: false, reason: 'tx_not_found' }
  }
}

export async function waitVaultNonce(user: string, minNonce: bigint, maxMs = 90_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const n = await readVaultNonce(user)
    if (n >= minNonce) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('nonce_wait_timeout')
}

export async function settlePaymentOnChain(params: {
  from: string
  to: string
  amount: bigint
  nonce: bigint
  deadline: bigint
  signature: string
}): Promise<{ txId: string }> {
  const privateKey = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!privateKey) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  const { vault, vaultId } = loadVault()
  const [vaultNonce, vaultBal] = await Promise.all([
    vault.view.getNonce({ args: { user: params.from } }),
    vault.view.getBalance({ args: { user: params.from } })
  ])
  if (vaultNonce.returns !== params.nonce) throw new Error('nonce_mismatch')
  if (vaultBal.returns < params.amount) throw new Error('insufficient_vault_balance')

  const hubWallet = new PrivateKeyWallet({ privateKey })
  return withHubSigner(async () => {
    const settled = await SettlePayment.execute(hubWallet, {
      initialFields: {
        vault: vaultId,
        from: params.from,
        to: params.to,
        amount: params.amount,
        nonce: params.nonce,
        deadline: params.deadline,
        signature: params.signature
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 2n
    })
    await assertScriptOk(settled.txId)
    invalidateVaultNonce(params.from)
    return { txId: settled.txId }
  })
}

async function assertScriptOk(txId: string) {
  const node = web3.getCurrentNodeProvider()
  const t0 = Date.now()
  while (Date.now() - t0 < 90_000) {
    try {
      const status = await node.transactions.getTransactionsStatus({ txId })
      if ((status as { type?: string }).type === 'Confirmed') {
        const details = (await node.transactions.getTransactionsDetailsTxid(txId)) as {
          scriptExecutionOk?: boolean
        }
        if (details.scriptExecutionOk === false) throw new Error('script_execution_failed')
        return
      }
    } catch (e: any) {
      if (e?.message === 'script_execution_failed') throw e
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('tx_not_confirmed')
}
