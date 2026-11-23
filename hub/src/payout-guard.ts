import { AuthedRequest } from './auth'
import { NextFunction, Response } from 'express'
import { listDestinations, listPayouts } from './store'

const ZERO = '0x0000000000000000000000000000000000000000'
const lastPayoutAt = new Map<string, number>()

export function payoutsEnabled(): boolean {
  return process.env.HUB_PAYOUTS_ENABLED === '1'
}

export function destWaitMs(): number {
  const n = Number(process.env.HUB_PAYOUT_DEST_WAIT_MS ?? 24 * 60 * 60 * 1000)
  return Number.isFinite(n) && n >= 0 ? n : 24 * 60 * 60 * 1000
}

export function payoutCooldownMs(): number {
  const n = Number(process.env.HUB_PAYOUT_COOLDOWN_MS ?? 15 * 60 * 1000)
  return Number.isFinite(n) && n >= 0 ? n : 15 * 60 * 1000
}

export function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? 'https://xpay.heartbix.com').replace(/\/$/, '')
}

export function isForbiddenEvmAddress(address: string): boolean {
  return address.trim().toLowerCase() === ZERO
}

export function requireSession(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth?.via !== 'session') {
    return res.status(403).json({ error: 'session_required' })
  }
  return next()
}

export function requireAppOrigin(req: AuthedRequest, res: Response, next: NextFunction) {
  const allowed = appBaseUrl()
  const origin = String(req.headers.origin ?? '').replace(/\/$/, '')
  const referer = String(req.headers.referer ?? '')
  if (origin && origin === allowed) return next()
  if (referer.startsWith(`${allowed}/`) || referer === allowed) return next()
  return res.status(403).json({ error: 'forbidden_origin' })
}

export function assertPayoutDestination(userId: string, chain: string, toAddress: string): void {
  if (isForbiddenEvmAddress(toAddress)) throw new Error('invalid_address')
  const addr = toAddress.trim().toLowerCase()
  const dest = listDestinations(userId).find(
    (d) => d.chain === chain && d.address.trim().toLowerCase() === addr
  )
  if (!dest) throw new Error('destination_not_saved')
  const wait = destWaitMs()
  const age = Date.now() - Date.parse(dest.createdAt)
  if (wait > 0 && (!Number.isFinite(age) || age < wait)) throw new Error('destination_cooling_down')
}

export function assertPayoutRateLimit(userId: string): void {
  const wait = payoutCooldownMs()
  const prev = lastPayoutAt.get(userId) ?? 0
  if (wait > 0 && Date.now() - prev < wait) throw new Error('payout_rate_limited')
  const recent = listPayouts(userId).find((p) => {
    if (p.status === 'failed') return false
    const t = Date.parse(p.createdAt)
    return Number.isFinite(t) && Date.now() - t < wait
  })
  if (recent) throw new Error('payout_rate_limited')
}

export function notePayoutAttempt(userId: string): void {
  lastPayoutAt.set(userId, Date.now())
}
