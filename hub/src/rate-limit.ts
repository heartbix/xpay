import { NextFunction, Request, Response } from 'express'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Drop expired buckets so the map cannot grow without bound. */
function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function clientIp(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim()
  if (forwarded) return forwarded
  return String(req.socket?.remoteAddress ?? req.ip ?? '').replace(/^::ffff:/, '')
}

/**
 * Fixed-window rate limiter. Keyed by IP plus an optional discriminator
 * (e.g. the email being verified) so one attacker cannot burn another
 * user's budget.
 */
export function rateLimit(opts: {
  windowMs: number
  max: number
  key?: (req: Request) => string
  message?: string
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (buckets.size > 5000) prune(now)
    const extra = opts.key ? opts.key(req) : ''
    const key = `${clientIp(req)}|${extra}`
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
      return next()
    }
    bucket.count += 1
    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({ error: opts.message ?? 'rate_limited', retryAfter })
    }
    return next()
  }
}

/** Test helper: clears all buckets. */
export function resetRateLimits() {
  buckets.clear()
}
