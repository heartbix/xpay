import { Contract, Wallet } from 'ethers'
import { v4 as uuidv4 } from 'uuid'
import { hubMnemonic, treasuryEvmWallet } from './addresses'
import { SupportedChain, getToken, isSupportedChain, isTokenSymbol } from './chains'
import { applyFeeToGross, minWithdrawAtomic, quoteWithdrawFee } from './fees'
import { sendAlertEmail } from './mail'
import { pushOpsEvent } from './ops-events'
import { withProvider } from './rpc'
import { ensureUsdtOnChain } from './route-usdt'
import { receiptCostUsdtAtomic } from './tx-cost'
import { toTokenUnits, treasuryUsdtAtomic } from './treasury-usdt'
import {
  assertPayoutDestination,
  assertPayoutRateLimit,
  isForbiddenEvmAddress,
  notePayoutAttempt,
  payoutsEnabled
} from './payout-guard'
import {
  DEFAULT_PAYOUT_THRESHOLD_ATOMIC,
  PayoutRecord,
  availableBalanceAtomic,
  getUser,
  isTestAccount,
  saveAlert,
  savePayout,
  spendableBalanceAtomic
} from './store'
import { readVaultBalance } from './alph-x402'

const ERC20_ABI = ['function transfer(address to, uint256 amount) returns (bool)']

/**
 * Ledger balance capped by the vault's on-chain balance. If the vault read
 * fails we fall back to the ledger so a node hiccup does not block withdrawals.
 */
async function spendableBalance(userId: string): Promise<bigint> {
  const ledger = availableBalanceAtomic(userId)
  const user = getUser(userId)
  if (!user?.alphAddress) return ledger
  try {
    const vault = await readVaultBalance(user.alphAddress)
    return spendableBalanceAtomic(userId, vault)
  } catch {
    return ledger
  }
}

export async function maybeSchedulePayout(userId: string): Promise<PayoutRecord | undefined> {
  if (!payoutsEnabled()) return
  if (isTestAccount(userId)) return
  const user = getUser(userId)
  if (!user?.payoutEnabled) return
  if (!user.payoutAddress || !user.payoutChain) return
  if (!isSupportedChain(user.payoutChain)) return
  try {
    assertPayoutDestination(userId, user.payoutChain, user.payoutAddress)
    assertPayoutRateLimit(userId)
  } catch {
    return
  }
  const token = 'USDT'
  const threshold = BigInt(user.payoutThresholdAtomic || DEFAULT_PAYOUT_THRESHOLD_ATOMIC)
  const available = await spendableBalance(userId)
  if (available < threshold) return

  const quote = await quoteWithdrawFee(user.payoutChain, available.toString())
  if (available < minWithdrawAtomic()) return
  if (available <= BigInt(quote.totalUsdtAtomic || '0')) return
  const split = applyFeeToGross(available.toString(), quote)
  if (BigInt(split.netAtomic) <= 0n) return

  const now = new Date().toISOString()
  const row: PayoutRecord = {
    id: uuidv4(),
    userId,
    chain: user.payoutChain,
    token,
    toAddress: user.payoutAddress,
    amountAtomic: split.grossAtomic,
    feeAtomic: split.feeAtomic,
    netAtomic: split.netAtomic,
    gasAlph: quote.gasAlph,
    alphUsd: quote.alphUsd,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now
  }
  savePayout(row)
  saveAlert({
    id: uuidv4(),
    userId,
    kind: 'payout',
    message: `Auto-transfer of ${split.netAtomic} (fee ${split.feeAtomic}) scheduled to ${user.payoutChain}.`,
    emailed: false,
    createdAt: now
  })
  return startOrQueuePayout(row)
}

export async function requestPayout(params: {
  userId: string
  chain: string
  token: string
  toAddress: string
  amountAtomic: string
}): Promise<PayoutRecord> {
  if (!payoutsEnabled()) throw new Error('payouts_locked')
  if (isTestAccount(params.userId)) throw new Error('test_account_no_payout')
  if (!isSupportedChain(params.chain)) throw new Error('unsupported_chain')
  if (!isTokenSymbol(params.token)) throw new Error('unsupported_token')
  if (params.token !== 'USDT') throw new Error('withdraw_usdt_only')
  const toAddress = params.toAddress.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(toAddress) || isForbiddenEvmAddress(toAddress)) {
    throw new Error('invalid_address')
  }
  assertPayoutDestination(params.userId, params.chain, toAddress)
  assertPayoutRateLimit(params.userId)
  const amount = BigInt(params.amountAtomic || '0')
  if (amount <= 0n) throw new Error('invalid_amount')
  const available = await spendableBalance(params.userId)
  if (available < amount) throw new Error('insufficient_balance')

  const quote = await quoteWithdrawFee(params.chain, amount.toString())
  const fee = BigInt(quote.totalUsdtAtomic || '0')
  if (amount < minWithdrawAtomic()) throw new Error('below_min_withdraw')
  if (amount <= fee) throw new Error('amount_too_small_for_fees')
  const split = applyFeeToGross(amount.toString(), quote)
  if (BigInt(split.netAtomic) <= 0n) throw new Error('amount_too_small_for_fees')

  const now = new Date().toISOString()
  const row: PayoutRecord = {
    id: uuidv4(),
    userId: params.userId,
    chain: params.chain,
    token: params.token,
    toAddress,
    amountAtomic: split.grossAtomic,
    feeAtomic: split.feeAtomic,
    netAtomic: split.netAtomic,
    gasAlph: quote.gasAlph,
    alphUsd: quote.alphUsd,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now
  }
  savePayout(row)
  notePayoutAttempt(params.userId)
  pushOpsEvent({
    kind: 'payout',
    status: 'scheduled',
    title: 'Withdraw scheduled',
    detail: `${row.token} on ${row.chain}`,
    chain: row.chain
  })
  return startOrQueuePayout(row)
}

export async function startOrQueuePayout(row: PayoutRecord): Promise<PayoutRecord> {
  const net = BigInt(row.netAtomic || '0')
  try {
    const have = await treasuryUsdtAtomic(row.chain)
    if (have >= net) return executePayout(row)
  } catch {
    /* background queue routes then sends */
  }
  pushOpsEvent({
    kind: 'payout',
    status: 'scheduled',
    title: 'Withdraw routing',
    detail: `USDT to ${row.chain}`,
    chain: row.chain
  })
  return row
}

async function payoutWallet(chain: SupportedChain) {
  return withProvider(chain, async (provider) => {
    await provider.getBlockNumber()
    if (hubMnemonic()) return treasuryEvmWallet().connect(provider)
    const privateKey = process.env.HUB_PRIVATE_KEY?.trim()
    if (!privateKey) throw new Error('treasury_key_missing')
    return new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider)
  })
}

export async function executePayout(row: PayoutRecord): Promise<PayoutRecord> {
  if (row.status === 'sent') return row
  if (!payoutsEnabled() || isForbiddenEvmAddress(row.toAddress)) {
    row.status = 'failed'
    row.error = payoutsEnabled() ? 'invalid_address' : 'payouts_locked'
    row.updatedAt = new Date().toISOString()
    return savePayout(row)
  }
  row.status = 'sending'
  row.updatedAt = new Date().toISOString()
  savePayout(row)
  try {
    const route = await ensureUsdtOnChain(row.chain, BigInt(row.netAtomic || '0'))
    const token = getToken(row.chain, row.token)
    const wallet = await payoutWallet(row.chain)
    const contract = new Contract(token.address, ERC20_ABI, wallet)
    const amount = toTokenUnits(row.netAtomic, token.decimals)
    const tx = await contract.transfer(row.toAddress, amount)
    const mined = await tx.wait()
    row.status = 'sent'
    row.txHash = mined?.hash ?? tx.hash
    row.routeTxHash = route.routeTxHash
    row.hopUsdtAtomic = route.hopAtomic
    const destGas = BigInt(await receiptCostUsdtAtomic(row.chain, mined))
    row.costUsdtAtomic = (
      destGas + BigInt(route.gasAtomic || '0') + BigInt(route.hopAtomic || '0')
    ).toString()
    row.error = undefined
    row.updatedAt = new Date().toISOString()
    savePayout(row)
    pushOpsEvent({
      kind: 'payout',
      status: 'sent',
      title: 'Withdraw sent',
      detail: `${row.token} on ${row.chain}`,
      txId: row.txHash,
      chain: row.chain
    })
    const user = getUser(row.userId)
    if (user?.email) {
      const emailed = await sendAlertEmail(
        user.email,
        'XPay auto-transfer sent',
        `Sent ${row.netAtomic} ${row.token} to ${row.toAddress} on ${row.chain}. Fee ${row.feeAtomic} (gas + platform). Tx ${row.txHash}`
      )
      saveAlert({
        id: uuidv4(),
        userId: row.userId,
        kind: 'payout',
        message: `Auto-transfer sent ${row.txHash}`,
        emailed,
        createdAt: new Date().toISOString()
      })
    }
    return row
  } catch (e: any) {
    const code = e?.message ?? String(e)
    const retry =
      code === 'treasury_usdt_short' ||
      code === 'route_timeout' ||
      code === 'route_failed' ||
      code === 'route_no_tx' ||
      /403 Forbidden|Archive requests require a personal token|missing revert data/i.test(code)
    row.status = retry ? 'scheduled' : 'failed'
    row.error = code
    row.updatedAt = new Date().toISOString()
    return savePayout(row)
  }
}
