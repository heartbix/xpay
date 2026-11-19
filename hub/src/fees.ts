import { getAlphUsdPrice } from './price'
import { SupportedChain, isSupportedChain } from './chains'
import { treasuryUsdtAtomic } from './treasury-usdt'

const USDT_DECIMALS = 6n
/** Typical Alephium transfer gas. Override with HUB_GAS_ALPH. */
const DEFAULT_GAS_ALPH = 0.002
/** PaymentVault map insert lock (balances + nonces). Override whole vault ALPH fee with HUB_VAULT_FEE_ALPH. */
const DEFAULT_MAP_ENTRY_ALPH = 0.1
const VAULT_MAP_ENTRIES = 2

/** Dest payout gas floor (2× this is the no-hop withdraw fee). Override HUB_SWEEP_FEE_USD_<CHAIN>. */
const DEFAULT_SWEEP_USD: Record<SupportedChain, number> = {
  ethereum: 0.05,
  bsc: 0.008,
  polygon: 0.008,
  arbitrum: 0.004,
  base: 0.004
}

/**
 * Extra only when dest treasury cannot cover the send (Li.Fi/Across hop).
 * Sized ~2–3× measured USDT haircut + source gas. Override HUB_HOP_FEE_USD_<CHAIN>.
 */
const DEFAULT_HOP_USD: Record<SupportedChain, number> = {
  ethereum: 0.25,
  bsc: 0.02,
  polygon: 0.02,
  arbitrum: 0.015,
  base: 0.015
}

export type FeeQuote = {
  gasAlph: string
  alphUsd: string
  gasUsdtAtomic: string
  platformUsdtAtomic: string
  sweepUsdtAtomic: string
  hopUsdtAtomic?: string
  totalUsdtAtomic: string
  quotedAt: string
  chain?: string
}

const DEFAULT_MIN_DEPOSIT_USDT = 0
const DEFAULT_MIN_WITHDRAW_USDT = 1

export function minWithdrawUsdt(): number {
  const fromEnv = Number(process.env.HUB_MIN_WITHDRAW_USDT)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_MIN_WITHDRAW_USDT
}

export function minWithdrawAtomic(): bigint {
  return usdToAtomic(minWithdrawUsdt())
}

export function minDepositUsdt(): number {
  const fromEnv = Number(process.env.HUB_MIN_DEPOSIT_USDT)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_MIN_DEPOSIT_USDT
}

export function minDepositAtomic(): bigint {
  return usdToAtomic(minDepositUsdt())
}

export function isBelowMinDeposit(amountAtomic: string): boolean {
  return BigInt(amountAtomic || '0') < minDepositAtomic()
}

function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n
  return BigInt(Math.max(0, Math.round(usd * 1_000_000)))
}

/** Ceil USD to the next USDT decimal (6 dp). 0.0000032 → 0.000004. */
export function ceilUsdToUsdtAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n
  return BigInt(Math.ceil(usd * 1_000_000 - 1e-12))
}

/** Ceil USD to the next 0.01 (platform keeps the extra cent). Exact cents stay. */
export function ceilUsdToCent(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0
  return Math.ceil(usd * 100 - 1e-12) / 100
}

/** Withdraw vault ALPH → USDT atomic, ceiled to 0.01. Do not use for x402. */
function vaultAlphToUsdtAtomic(alphAmount: number, alphUsd: number): bigint {
  if (!Number.isFinite(alphAmount) || alphAmount <= 0) return 0n
  if (!Number.isFinite(alphUsd) || alphUsd <= 0) return 0n
  return usdToAtomic(ceilUsdToCent(alphAmount * alphUsd))
}

export function gasAlphAmount(): number {
  const fromEnv = Number(process.env.HUB_GAS_ALPH)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_GAS_ALPH
}

/** ALPH spent to credit a user (2× map deposit + 2× gas), recouped in USDT on withdraw. */
export function vaultAlphFeeAmount(): number {
  const fromEnv = Number(process.env.HUB_VAULT_FEE_ALPH)
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
  return VAULT_MAP_ENTRIES * DEFAULT_MAP_ENTRY_ALPH + 2 * gasAlphAmount()
}

export function sweepFeeUsd(chain: SupportedChain): number {
  const envKey = `HUB_SWEEP_FEE_USD_${chain.toUpperCase()}`
  const fromEnv = Number(process.env[envKey])
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
  return DEFAULT_SWEEP_USD[chain]
}

export function hopFeeUsd(chain: SupportedChain): number {
  const envKey = `HUB_HOP_FEE_USD_${chain.toUpperCase()}`
  const fromEnv = Number(process.env[envKey])
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv
  return DEFAULT_HOP_USD[chain]
}

/**
 * x402 USDT quote: charge 2× real ALPH gas (1× covers settle, 1× is PnL).
 * HUB_X402_FEE_USDT overrides the total when set (> 0).
 */
export async function quoteX402Fee(): Promise<FeeQuote> {
  const gasAlph = gasAlphAmount()
  const alphUsd = await getAlphUsdPrice()
  const gasUsd = gasAlph * alphUsd
  const gasAtomic = ceilUsdToUsdtAtomic(gasUsd)
  const fromEnv = Number(process.env.HUB_X402_FEE_USDT)
  const envAtomic =
    Number.isFinite(fromEnv) && fromEnv > 0 ? ceilUsdToUsdtAtomic(fromEnv) : 0n
  const total = envAtomic > 0n ? envAtomic : gasAtomic * 2n
  const platform = total > gasAtomic ? total - gasAtomic : 0n
  return {
    gasAlph: gasAlph.toFixed(8),
    alphUsd: alphUsd.toFixed(8),
    gasUsdtAtomic: gasAtomic.toString(),
    platformUsdtAtomic: platform.toString(),
    sweepUsdtAtomic: '0',
    hopUsdtAtomic: '0',
    totalUsdtAtomic: total.toString(),
    quotedAt: new Date().toISOString()
  }
}

export async function quoteTxFee(): Promise<FeeQuote> {
  const gasAlph = gasAlphAmount()
  const alphUsd = await getAlphUsdPrice()
  const gasUsd = gasAlph * alphUsd
  const gasUsdtAtomic = usdToAtomic(gasUsd)
  const platformUsdtAtomic = gasUsdtAtomic
  const sweepUsdtAtomic = 0n
  const totalUsdtAtomic = gasUsdtAtomic + platformUsdtAtomic + sweepUsdtAtomic
  return {
    gasAlph: gasAlph.toFixed(6),
    alphUsd: alphUsd.toFixed(6),
    gasUsdtAtomic: gasUsdtAtomic.toString(),
    platformUsdtAtomic: platformUsdtAtomic.toString(),
    sweepUsdtAtomic: sweepUsdtAtomic.toString(),
    hopUsdtAtomic: '0',
    totalUsdtAtomic: totalUsdtAtomic.toString(),
    quotedAt: new Date().toISOString()
  }
}

/** Deposits: no USDT cut. Sweep cost is recovered on withdraw. */
export async function quoteDepositFee(chain: string): Promise<FeeQuote> {
  const now = new Date().toISOString()
  return {
    gasAlph: '0',
    alphUsd: '0',
    gasUsdtAtomic: '0',
    platformUsdtAtomic: '0',
    sweepUsdtAtomic: '0',
    hopUsdtAtomic: '0',
    totalUsdtAtomic: '0',
    quotedAt: now,
    chain: isSupportedChain(chain) ? chain : undefined
  }
}

async function destCovers(chain: SupportedChain, needAtomic: bigint): Promise<boolean> {
  if (needAtomic <= 0n) return true
  try {
    return (await treasuryUsdtAtomic(chain)) >= needAtomic
  } catch {
    return false
  }
}

/** Withdrawal: 2× dest gas. Hop extra only if treasury must route into the dest chain. */
export async function quoteWithdrawFee(chain: string, amountAtomic?: string): Promise<FeeQuote> {
  const base = await quoteTxFee()
  if (!isSupportedChain(chain)) {
    return {
      ...base,
      gasUsdtAtomic: '0',
      platformUsdtAtomic: '0',
      sweepUsdtAtomic: '0',
      hopUsdtAtomic: '0',
      totalUsdtAtomic: '0'
    }
  }
  const destGas = usdToAtomic(sweepFeeUsd(chain))
  const need = BigInt(amountAtomic && /^\d+$/.test(amountAtomic) ? amountAtomic : minWithdrawAtomic().toString())
  const hop = (await destCovers(chain, need)) ? 0n : usdToAtomic(hopFeeUsd(chain))
  const total = destGas + destGas + hop
  return {
    ...base,
    chain,
    gasUsdtAtomic: destGas.toString(),
    platformUsdtAtomic: destGas.toString(),
    sweepUsdtAtomic: '0',
    hopUsdtAtomic: hop.toString(),
    totalUsdtAtomic: total.toString()
  }
}

export function applyFeeToGross(grossAtomic: string, quote: FeeQuote): {
  grossAtomic: string
  feeAtomic: string
  netAtomic: string
  quote: FeeQuote
} {
  const gross = BigInt(grossAtomic || '0')
  const fee = BigInt(quote.totalUsdtAtomic)
  if (gross <= fee) {
    return { grossAtomic: gross.toString(), feeAtomic: fee.toString(), netAtomic: '0', quote }
  }
  return {
    grossAtomic: gross.toString(),
    feeAtomic: fee.toString(),
    netAtomic: (gross - fee).toString(),
    quote
  }
}

export function formatUsdtAtomic(atomic: string): string {
  const n = BigInt(atomic || '0')
  const whole = n / 10n ** USDT_DECIMALS
  const frac = (n % 10n ** USDT_DECIMALS).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}
