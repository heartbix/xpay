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

export async function readVaultNonce(user: string): Promise<bigint> {
  const { vault } = loadVault()
  return (await vault.view.getNonce({ args: { user } })).returns
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
