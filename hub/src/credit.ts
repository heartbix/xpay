import { DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { isBelowMinDeposit } from './fees'
import { attachFeeQuote, afterBalanceChange } from './ledger'
import { pushOpsEvent } from './ops-events'
import { DepositRecord, getUser, saveDeposit } from './store'

/**
 * Credits PaymentVault on Alephium after a source-chain deposit is confirmed.
 * Requires ALEPHIUM deployments + HUB_ALPH_PRIVATE_KEY funded with MUSDT + ALPH.
 */
export async function creditVaultOnAlephium(deposit: DepositRecord): Promise<DepositRecord> {
  const user = getUser(deposit.userId)
  if (!user?.alphAddress) {
    deposit.status = 'failed'
    deposit.error = 'user_missing_alph_address'
    deposit.updatedAt = new Date().toISOString()
    return saveDeposit(deposit)
  }

  const privateKey = process.env.HUB_ALPH_PRIVATE_KEY
  if (!privateKey) {
    deposit.status = 'failed'
    deposit.error = 'HUB_ALPH_PRIVATE_KEY missing'
    deposit.updatedAt = new Date().toISOString()
    return saveDeposit(deposit)
  }

  try {
    const nodeUrl = process.env.ALEPHIUM_NODE_URL ?? 'http://127.0.0.1:22973'
    web3.setCurrentNodeProvider(nodeUrl)
    // Runtime export is my-contracts/deployments (tsc moduleResolution node cannot type it).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadDeployments } = require('my-contracts/deployments') as {
      loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
        contracts: {
          PaymentVault: { contractInstance: { address: string } }
          MockUSDT: { contractInstance: { contractId: string } }
        }
      }
    }
    const network = (process.env.ALEPHIUM_NETWORK ?? 'devnet') as 'devnet' | 'testnet' | 'mainnet'
    const deployments = loadDeployments(network)
    const vault = deployments.contracts.PaymentVault.contractInstance
    const usdtId = deployments.contracts.MockUSDT.contractInstance.contractId

    // Dynamic import of generated TxScript is awkward; call contract method via signer execute
    const { PaymentVault } = await import('my-contracts')
    const signer = new PrivateKeyWallet({ privateKey })
    deposit = await attachFeeQuote(deposit)
    if (isBelowMinDeposit(deposit.amountAtomic || deposit.netAtomic || '0')) {
      deposit.status = 'failed'
      deposit.error = 'below_minimum_deposit'
      deposit.updatedAt = new Date().toISOString()
      return saveDeposit(deposit)
    }
    const amount = BigInt(deposit.netAtomic || '0')
    if (amount <= 0n) {
      deposit.status = 'failed'
      deposit.error = 'amount_too_small_for_fees'
      deposit.updatedAt = new Date().toISOString()
      return saveDeposit(deposit)
    }

    const result = await PaymentVault.at(vault.address).transact.creditFromHub({
      signer,
      args: { user: user.alphAddress, amount },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 2n + DUST_AMOUNT,
      tokens: [{ id: usdtId, amount }]
    })

    deposit.status = 'credited'
    deposit.creditTxId = result.txId
    deposit.error = undefined
    deposit.updatedAt = new Date().toISOString()
    const saved = saveDeposit(deposit)
    pushOpsEvent({
      kind: 'deposit',
      status: 'credited',
      title: 'Ledger credited',
      detail: `${deposit.amountUsdt} ${deposit.token || 'USDT'} on ${deposit.chain}`,
      txId: deposit.txHash,
      chain: deposit.chain
    })
    await afterBalanceChange(deposit.userId)
    return saved
  } catch (e: any) {
    deposit.status = 'failed'
    deposit.error = e?.message ?? String(e)
    deposit.updatedAt = new Date().toISOString()
    pushOpsEvent({
      kind: 'deposit',
      status: 'failed',
      title: 'Credit failed',
      detail: deposit.error || 'credit_failed',
      txId: deposit.txHash,
      chain: deposit.chain
    })
    return saveDeposit(deposit)
  }
}
