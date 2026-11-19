import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Request, Response } from 'express'

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(path.join(__dirname, '..', '..', '.env'))
loadEnvFile(path.join(__dirname, '..', '.env'))

export type OAuthProvider = 'google' | 'github'

const STATE_TTL_MS = 10 * 60 * 1000
const states = new Map<string, { provider: OAuthProvider; expiresAt: number }>()

function pruneStates() {
  const now = Date.now()
  for (const [key, value] of states) {
    if (value.expiresAt < now) states.delete(key)
  }
}

export function oauthConfigured(provider: OAuthProvider): boolean {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  }
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
}

export function listConfiguredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = []
  if (oauthConfigured('google')) providers.push('google')
  if (oauthConfigured('github')) providers.push('github')
  return providers
}

export function publicAppUrl(): string {
  return (process.env.PUBLIC_APP_URL ?? 'https://xpay.heartbix.com').replace(/\/$/, '')
}

export function createOAuthState(provider: OAuthProvider): string {
  pruneStates()
  const state = crypto.randomBytes(24).toString('hex')
  states.set(state, { provider, expiresAt: Date.now() + STATE_TTL_MS })
  return state
}

export function consumeOAuthState(state: string, provider: OAuthProvider): boolean {
  pruneStates()
  const row = states.get(state)
  if (!row || row.provider !== provider) return false
  states.delete(state)
  return true
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: `${publicAppUrl()}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export function githubAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID ?? '',
    redirect_uri: `${publicAppUrl()}/api/auth/github/callback`,
    scope: 'read:user user:email',
    state
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export async function exchangeGoogleCode(code: string): Promise<{
  providerId: string
  email: string
  name?: string
}> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirect_uri: `${publicAppUrl()}/api/auth/google/callback`,
    grant_type: 'authorization_code'
  })
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const tokenJson = (await tokenRes.json()) as { id_token?: string; error?: string }
  if (!tokenJson.id_token) throw new Error(tokenJson.error ?? 'google_token_failed')

  const infoRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenJson.id_token)}`
  )
  const info = (await infoRes.json()) as {
    aud?: string
    sub?: string
    email?: string
    email_verified?: string | boolean
    name?: string
  }
  if (info.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('google_aud_mismatch')
  if (!info.sub || !info.email) throw new Error('google_profile_incomplete')
  if (info.email_verified !== true && info.email_verified !== 'true') throw new Error('google_email_unverified')
  return { providerId: info.sub, email: info.email, name: info.name }
}

export async function exchangeGithubCode(code: string): Promise<{
  providerId: string
  email: string
  name?: string
}> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${publicAppUrl()}/api/auth/github/callback`
    })
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenJson.access_token) throw new Error(tokenJson.error ?? 'github_token_failed')

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'alephium-usdt-x402'
    }
  })
  const profile = (await userRes.json()) as { id?: number; email?: string | null; name?: string; login?: string }

  let email = profile.email ?? ''
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'alephium-usdt-x402'
      }
    })
    const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
    const preferred = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
    email = preferred?.email ?? ''
  }

  if (!profile.id || !email) throw new Error('github_profile_incomplete')
  return {
    providerId: String(profile.id),
    email,
    name: profile.name || profile.login
  }
}

export function redirectToAccount(res: Response, query: Record<string, string>) {
  const url = new URL('/account', publicAppUrl())
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  res.redirect(url.toString())
}

export function beginOAuth(provider: OAuthProvider, req: Request, res: Response) {
  if (!oauthConfigured(provider)) {
    return redirectToAccount(res, { oauth: 'not_configured', provider })
  }
  const state = createOAuthState(provider)
  const url = provider === 'google' ? googleAuthUrl(state) : githubAuthUrl(state)
  res.redirect(url)
}
