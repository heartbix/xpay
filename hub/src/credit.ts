import { DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { isBelowMinDeposit } from './fees'
import { attachFeeQuote, afterBalanceChange } from './ledger'
import { sendAlertEmail } from './mail'
import { pushOpsEvent } from './ops-events'
import { DepositRecord, getUser, listDeposits, saveDeposit } from './store'

function formatUsdt(atomic: string | undefined): string {
  const n = BigInt(atomic || '0')
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

function explorerUrl(chain: string, txHash: string): string {
  const base: Record<string, string> = {
    ethereum: 'https://etherscan.io/tx/',
    bsc: 'https://bscscan.com/tx/',
    polygon: 'https://polygonscan.com/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    base: 'https://basescan.org/tx/'
  }
  return `${base[chain] ?? ''}${txHash}`
}

/**
 * Tells the depositor and the operator that a deposit reached the ledger.
 * Fire-and-forget: a mail failure must never roll back a credit.
 */
function notifyDepositCredited(deposit: DepositRecord, email: string | undefined): void {
  const amount = formatUsdt(deposit.netAtomic || deposit.amountAtomic)
  const token = deposit.token || 'USDT'
  const link = explorerUrl(deposit.chain, deposit.txHash)
  const adminTo = process.env.DEPOSIT_ALERT_TO?.trim() || process.env.SMTP_USER?.trim()

  if (email) {
    const text = [
      `Your deposit is credited.`,
      ``,
      `Amount : ${amount} ${token}`,
      `Network: ${deposit.chain}`,
      `Tx     : ${deposit.txHash}`,
      link ? `Explorer: ${link}` : '',
      ``,
      `The balance is available now for x402 payments or a withdrawal.`,
      ``,
      `— XPay`
    ]
      .filter((line) => line !== '')
      .join('\n')
    void sendAlertEmail(email, `Deposit credited: ${amount} ${token}`, text).catch(() => undefined)
  }

  if (adminTo) {
    const text = [
      `A deposit was credited.`,
      ``,
      `Account: ${email || deposit.userId}`,
      `Amount : ${amount} ${token}`,
      `Network: ${deposit.chain}`,
      `Tx     : ${deposit.txHash}`,
      deposit.creditTxId ? `Credit : ${deposit.creditTxId}` : '',
      link ? `Explorer: ${link}` : '',
      ``,
      `— XPay hub`
    ]
      .filter((line) => line !== '')
      .join('\n')
    void sendAlertEmail(adminTo, `[XPay] Deposit credited: ${amount} ${token}`, text).catch(() => undefined)
  }
}

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
    const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
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
    notifyDepositCredited(saved, user.email)
    return saved
  } catch (e: any) {
    const code = e?.message ?? String(e)
    // The source-chain USDT has already been swept to treasury, so a transient
    // failure (hub wallet out of MUSDT, node hiccup) must stay retryable.
    // Only permanent errors mark the deposit failed.
    const permanent =
      code === 'below_minimum_deposit' ||
      code === 'amount_too_small_for_fees' ||
      code === 'user_missing_alph_address' ||
      /Invalid address|decoding failure/i.test(code)
    deposit.status = permanent ? 'failed' : 'confirmed'
    deposit.error = code
    deposit.updatedAt = new Date().toISOString()
    pushOpsEvent({
      kind: 'deposit',
      status: permanent ? 'failed' : 'detected',
      title: permanent ? 'Credit failed' : 'Credit retry pending',
      detail: code || 'credit_failed',
      txId: deposit.txHash,
      chain: deposit.chain
    })
    return saveDeposit(deposit)
  }
}

/**
 * Retries deposits that were confirmed on the source chain but never credited
 * to the vault. Runs from the watcher loop so a transient credit failure
 * (e.g. hub wallet temporarily out of MUSDT) self-heals.
 */
export async function retryUncreditedDeposits(): Promise<void> {
  if (process.env.HUB_AUTO_CREDIT !== '1') return
  const pending = listDeposits().filter((d) => d.status === 'confirmed' && !d.creditTxId)
  for (const deposit of pending) {
    const age = Date.now() - Date.parse(deposit.updatedAt || deposit.createdAt)
    if (!Number.isFinite(age) || age < 60_000) continue
    console.log(`[credit] retrying ${deposit.chain} ${deposit.txHash} (${deposit.error ?? 'pending'})`)
    await creditVaultOnAlephium(deposit)
  }
}
