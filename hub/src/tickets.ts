import { sendAlertEmail } from './mail'

const KINDS = ['idea', 'improvement', 'issue'] as const
export type TicketKind = (typeof KINDS)[number]

const hits = new Map<string, number[]>()
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 5
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function tooMany(ip: string): boolean {
  const now = Date.now()
  const next = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  if (next.length >= MAX_PER_WINDOW) {
    hits.set(ip, next)
    return true
  }
  next.push(now)
  hits.set(ip, next)
  return false
}

export async function submitTicket(input: {
  kind?: string
  email?: string
  message?: string
  name?: string
  ip?: string
}): Promise<{ mailed: boolean }> {
  if (tooMany(input.ip || 'unknown')) throw new Error('ticket_rate_limited')
  const kind = String(input.kind || '').trim().toLowerCase()
  if (!KINDS.includes(kind as TicketKind)) throw new Error('invalid_kind')
  const email = String(input.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) throw new Error('invalid_email')
  const message = String(input.message || '').trim()
  if (message.length < 10) throw new Error('message_too_short')
  if (message.length > 4000) throw new Error('message_too_long')
  const name = String(input.name || '').trim().slice(0, 80)
  const to = process.env.TICKET_MAIL?.trim() || 'xpay-ticket@heartbix.com'
  const subject = `[XPay ${kind}] ${name || email}`
  const text = [
    `Kind: ${kind}`,
    `From: ${name || '—'} <${email}>`,
    `IP: ${input.ip || '—'}`,
    '',
    message
  ].join('\n')
  const mailed = await sendAlertEmail(to, subject, text, { replyTo: email })
  if (!mailed) throw new Error('mail_failed')
  return { mailed: true }
}
