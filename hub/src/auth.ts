import crypto from 'crypto'
import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  createEmailUser,
  findApiKeyByHash,
  findSessionByTokenHash,
  findUserByEmail,
  findUserByVerifyTokenHash,
  findUserByGithubId,
  findUserByGoogleId,
  getUser,
  saveSession,
  touchApiKey,
  updateUser,
  ensureUserAlphAddress
} from './store'
import { sendAlertEmail } from './mail'
import { OAuthProvider } from './oauth'

/** Session lifetime. Override with HUB_SESSION_TTL_MS (default 1 hour). */
function sessionTtlMs(): number {
  const n = Number(process.env.HUB_SESSION_TTL_MS)
  if (Number.isFinite(n) && n >= 60_000) return n
  return 60 * 60 * 1000
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AuthedRequest = Request & {
  auth?: {
    userId: string
    email?: string
    alphAddress?: string
    via: 'session' | 'apiKey'
    apiKeyId?: string
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 32).toString('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function issueSession(userId: string): { token: string; expiresAt: string; userId: string } {
  const token = `sess_${crypto.randomBytes(24).toString('hex')}`
  const expiresAt = new Date(Date.now() + sessionTtlMs()).toISOString()
  saveSession({
    tokenHash: sha256Hex(token),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt
  })
  return { token, expiresAt, userId }
}

function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? 'https://xpay.heartbix.com').replace(/\/$/, '')
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length === 0 || left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

async function sendVerifyEmail(email: string, code: string, token: string): Promise<boolean> {
  const link = `${appBaseUrl()}/account?verifyToken=${encodeURIComponent(token)}`
  const text = [
    'Confirm your XPay account.',
    '',
    `Code: ${code}`,
    '',
    `Or open this link: ${link}`,
    '',
    'This expires in 30 minutes. If you did not create an account, ignore this email.'
  ].join('\n')
  return sendAlertEmail(email, 'Confirm your XPay email', text)
}

export async function issueEmailVerification(userId: string): Promise<{ mailed: boolean }> {
  const user = getUser(userId)
  if (!user?.email) throw new Error('invalid_email')
  const last = user.lastVerifySentAt ? Date.parse(user.lastVerifySentAt) : 0
  if (Date.now() - last < 60_000) throw new Error('verify_rate_limited')

  const code = String(crypto.randomInt(100000, 1000000))
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  updateUser(userId, {
    emailVerifyCodeHash: sha256Hex(code),
    emailVerifyTokenHash: sha256Hex(token),
    emailVerifyExpiresAt: expiresAt,
    lastVerifySentAt: new Date().toISOString()
  })
  const mailed = await sendVerifyEmail(user.email, code, token)
  return { mailed }
}

function clearVerifyFields(userId: string, extra: Partial<import('./store').HubUser> = {}) {
  updateUser(userId, {
    emailVerifyCodeHash: undefined,
    emailVerifyTokenHash: undefined,
    emailVerifyExpiresAt: undefined,
    ...extra
  })
}

export async function registerAccount(emailRaw: string, password: string, confirmPassword: string) {
  const email = normalizeEmail(emailRaw)
  if (!EMAIL_RE.test(email)) throw new Error('invalid_email')
  if (password.length < 8) throw new Error('password_too_short')
  if (password !== confirmPassword) throw new Error('password_mismatch')

  const existing = findUserByEmail(email)
  if (existing?.emailVerifiedAt) throw new Error('email_taken')
  if (existing && existing.passwordHash && existing.passwordSalt) {
    const hash = hashPassword(password, existing.passwordSalt)
    if (!safeEqualHex(hash, existing.passwordHash)) throw new Error('email_pending_verification')
    const mailed = await issueEmailVerification(existing.userId)
    return { email, mailed, userId: existing.userId }
  }
  if (existing) throw new Error('email_taken')

  const salt = crypto.randomBytes(16).toString('hex')
  const user = createEmailUser({
    userId: uuidv4(),
    email,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString()
  })
  ensureUserAlphAddress(user.userId)
  const mailed = await issueEmailVerification(user.userId)
  return { email, mailed, userId: user.userId }
}

export async function verifyEmail(params: { email?: string; code?: string; token?: string }) {
  const token = params.token?.trim()
  const code = params.code?.trim()
  const email = params.email ? normalizeEmail(params.email) : ''

  const user = token ? findUserByVerifyTokenHash(sha256Hex(token)) : email ? findUserByEmail(email) : undefined

  if (!user) throw new Error('invalid_verification')
  if (user.emailVerifiedAt) throw new Error('already_verified')
  const exp = user.emailVerifyExpiresAt ? Date.parse(user.emailVerifyExpiresAt) : 0
  if (!exp || Date.now() > exp) throw new Error('verification_expired')

  if (token) {
    if (!user.emailVerifyTokenHash || !safeEqualHex(sha256Hex(token), user.emailVerifyTokenHash)) {
      throw new Error('invalid_verification')
    }
  } else {
    if (!code || !/^\d{6}$/.test(code)) throw new Error('invalid_verification')
    if (!user.emailVerifyCodeHash || !safeEqualHex(sha256Hex(code), user.emailVerifyCodeHash)) {
      throw new Error('invalid_verification')
    }
  }

  clearVerifyFields(user.userId, { emailVerifiedAt: new Date().toISOString() })
  const provisioned = ensureUserAlphAddress(user.userId)
  return { user: provisioned, session: issueSession(provisioned.userId) }
}

export async function resendVerification(emailRaw: string) {
  const email = normalizeEmail(emailRaw)
  const user = findUserByEmail(email)
  if (!user?.passwordHash) throw new Error('invalid_credentials')
  if (user.emailVerifiedAt) throw new Error('already_verified')
  return issueEmailVerification(user.userId)
}

export function loginWithOAuth(params: {
  provider: OAuthProvider
  providerId: string
  email: string
  name?: string
}) {
  const email = normalizeEmail(params.email)
  if (!EMAIL_RE.test(email)) throw new Error('invalid_email')

  let user =
    params.provider === 'google'
      ? findUserByGoogleId(params.providerId)
      : findUserByGithubId(params.providerId)

  if (!user) {
    user = findUserByEmail(email)
    if (user) {
      updateUser(user.userId, {
        name: params.name ?? user.name,
        ...(params.provider === 'google' ? { googleId: params.providerId } : { githubId: params.providerId })
      })
    } else {
      user = createEmailUser({
        userId: uuidv4(),
        email,
        name: params.name,
        emailVerifiedAt: new Date().toISOString(),
        ...(params.provider === 'google' ? { googleId: params.providerId } : { githubId: params.providerId }),
        createdAt: new Date().toISOString()
      })
    }
  }

  if (!user.emailVerifiedAt) {
    updateUser(user.userId, { emailVerifiedAt: new Date().toISOString() })
  }
  const fresh = ensureUserAlphAddress(user.userId)
  return { user: fresh, session: issueSession(fresh.userId) }
}

export function loginAccount(emailRaw: string, password: string) {
  const email = normalizeEmail(emailRaw)
  const user = findUserByEmail(email)
  if (!user?.passwordHash || !user.passwordSalt) throw new Error('invalid_credentials')
  const hash = hashPassword(password, user.passwordSalt)
  if (!safeEqualHex(hash, user.passwordHash)) {
    throw new Error('invalid_credentials')
  }
  if (!user.emailVerifiedAt) {
    if (!user.emailVerifyCodeHash && !user.emailVerifyTokenHash) {
      updateUser(user.userId, { emailVerifiedAt: user.createdAt })
    } else {
      throw new Error('email_not_verified')
    }
  }
  const provisioned = ensureUserAlphAddress(user.userId)
  return { user: provisioned, session: issueSession(provisioned.userId) }
}

export function createApiKeySecret(): { secret: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(24).toString('hex')
  const secret = `ak_live_${raw}`
  return {
    secret,
    prefix: secret.slice(0, 12),
    hash: sha256Hex(secret)
  }
}

export function isPlatformAdminEmail(email?: string): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? 'admin@heartbix.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return Boolean(email && list.includes(email.trim().toLowerCase()))
}

/**
 * Optional admin IP allowlist. Set HUB_ADMIN_IPS to a comma-separated list of
 * client IPs (e.g. "79.116.140.135"). Empty/unset disables the check.
 */
function adminIpAllowlist(): string[] {
  return (process.env.HUB_ADMIN_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function clientIp(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim()
  if (forwarded) return forwarded
  return String(req.socket?.remoteAddress ?? req.ip ?? '').replace(/^::ffff:/, '')
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'unauthorized' })
  if (!isPlatformAdminEmail(req.auth.email)) return res.status(403).json({ error: 'forbidden' })
  const allow = adminIpAllowlist()
  if (allow.length > 0 && !allow.includes(clientIp(req))) {
    return res.status(403).json({ error: 'admin_ip_forbidden' })
  }
  return next()
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const apiKeyHeader = String(req.headers['x-api-key'] ?? '').trim()

  if (bearer) {
    const session = findSessionByTokenHash(sha256Hex(bearer))
    if (!session) return res.status(401).json({ error: 'invalid_session' })
    const user = getUser(session.userId)
    if (!user) return res.status(401).json({ error: 'invalid_session' })
    const provisioned = ensureUserAlphAddress(user.userId)
    req.auth = {
      userId: provisioned.userId,
      email: provisioned.email,
      alphAddress: provisioned.alphAddress,
      via: 'session'
    }
    return next()
  }

  if (apiKeyHeader) {
    const key = findApiKeyByHash(sha256Hex(apiKeyHeader))
    if (!key) return res.status(401).json({ error: 'invalid_api_key' })
    const user = ensureUserAlphAddress(key.userId)
    touchApiKey(key.id)
    req.auth = {
      userId: user.userId,
      email: user.email,
      alphAddress: user.alphAddress,
      via: 'apiKey',
      apiKeyId: key.id
    }
    return next()
  }

  return res.status(401).json({ error: 'unauthorized' })
}
