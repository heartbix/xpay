import { v4 as uuidv4 } from 'uuid'
import { applyFeeToGross, quoteDepositFee } from './fees'
import { sendAlertEmail } from './mail'
import { maybeSchedulePayout } from './payouts'
import {
  AlertRecord,
  DEFAULT_LOW_BALANCE_ATOMIC,
  DepositRecord,
  availableBalanceAtomic,
  getUser,
  saveAlert,
  saveDeposit,
  updateUser
} from './store'

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function attachFeeQuote(deposit: DepositRecord): Promise<DepositRecord> {
  const quote = await quoteDepositFee(deposit.chain)
  const split = applyFeeToGross(deposit.amountAtomic, quote)
  deposit.feeAtomic = split.feeAtomic
  deposit.gasFeeAtomic = quote.gasUsdtAtomic
  deposit.platformFeeAtomic = quote.platformUsdtAtomic
  deposit.sweepFeeAtomic = quote.sweepUsdtAtomic
  deposit.netAtomic = split.netAtomic
  deposit.gasAlph = quote.gasAlph
  deposit.alphUsd = quote.alphUsd
  deposit.updatedAt = new Date().toISOString()
  return saveDeposit(deposit)
}

export async function afterBalanceChange(userId: string): Promise<void> {
  await maybeAlertLowBalance(userId)
  await maybeSchedulePayout(userId)
}

export async function maybeAlertLowBalance(userId: string): Promise<void> {
  const user = getUser(userId)
  if (!user) return
  if (user.lowBalanceAlert === false) return
  const threshold = BigInt(user.lowBalanceThresholdAtomic || DEFAULT_LOW_BALANCE_ATOMIC)
  const available = availableBalanceAtomic(userId)
  if (available >= threshold) return

  const last = user.lastLowBalanceAlertAt ? Date.parse(user.lastLowBalanceAlertAt) : 0
  if (Date.now() - last < ALERT_COOLDOWN_MS) return

  const to = user.email
  const message = `XPay balance is ${format(available)} USDT, below your alert of ${format(threshold)} USDT.`
  let emailed = false
  if (to) {
    emailed = await sendAlertEmail(to, 'XPay low balance', message)
  }
  const row: AlertRecord = {
    id: uuidv4(),
    userId,
    kind: 'low_balance',
    message,
    emailed,
    createdAt: new Date().toISOString()
  }
  saveAlert(row)
  updateUser(userId, { lastLowBalanceAlertAt: row.createdAt })
}

function format(atomic: bigint): string {
  const whole = atomic / 1_000_000n
  const frac = (atomic % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}
