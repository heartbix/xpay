import tls from 'tls'

function mailFrom(): string {
  const explicit = process.env.MAIL_FROM?.trim()
  if (explicit) return explicit
  const user = process.env.SMTP_USER?.trim()
  if (user) return `XPay <${user}>`
  return 'XPay <noreply@heartbix.com>'
}

function parseFromAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return (m?.[1] || from).trim()
}

async function smtpSend(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const host = process.env.SMTP_SERVER?.trim()
  const user = process.env.SMTP_USER?.trim()
  const pass = (process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS)?.trim()
  const port = Number(process.env.SMTP_PORT || 465)
  if (!host || !user || !pass || !to) return false

  const fromHeader = mailFrom()
  const fromAddr = parseFromAddress(fromHeader)
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
  const body = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text.replace(/\r?\n/g, '\r\n'),
    ''
  ]
    .filter((line) => line !== null)
    .join('\r\n')

  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 20000 })
    let buf = ''
    let step = 0
    let done = false
    const finish = (ok: boolean, err?: string) => {
      if (done) return
      done = true
      if (!ok && err) console.error('[mail] smtp', err)
      try {
        socket.end()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }

    const write = (line: string) => {
      socket.write(line + '\r\n')
    }

    socket.setEncoding('utf8')
    socket.on('error', (e) => finish(false, e.message))
    socket.on('timeout', () => finish(false, 'timeout'))
    socket.on('data', (chunk: string) => {
      buf += chunk
      while (buf.includes('\r\n')) {
        const idx = buf.indexOf('\r\n')
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        if (!/^\d{3}[\s-]/.test(line)) continue
        const code = Number(line.slice(0, 3))
        const last = line[3] === ' '
        if (!last) continue
        try {
          if (step === 0) {
            if (code !== 220) return finish(false, line)
            write(`EHLO xpay.heartbix.com`)
            step = 1
          } else if (step === 1) {
            if (code !== 250) return finish(false, line)
            write('AUTH LOGIN')
            step = 2
          } else if (step === 2) {
            if (code !== 334) return finish(false, line)
            write(Buffer.from(user, 'utf8').toString('base64'))
            step = 3
          } else if (step === 3) {
            if (code !== 334) return finish(false, line)
            write(Buffer.from(pass, 'utf8').toString('base64'))
            step = 4
          } else if (step === 4) {
            if (code !== 235) return finish(false, 'auth_failed')
            write(`MAIL FROM:<${fromAddr}>`)
            step = 5
          } else if (step === 5) {
            if (code !== 250) return finish(false, line)
            write(`RCPT TO:<${to}>`)
            step = 6
          } else if (step === 6) {
            if (code !== 250 && code !== 251) return finish(false, line)
            write('DATA')
            step = 7
          } else if (step === 7) {
            if (code !== 354) return finish(false, line)
            write(body.replace(/^\./gm, '..') + '\r\n.')
            step = 8
          } else if (step === 8) {
            if (code !== 250) return finish(false, line)
            write('QUIT')
            finish(true)
          }
        } catch (e: any) {
          finish(false, e?.message ?? 'smtp_error')
        }
      }
    })
  })
}

async function resendSend(to: string, subject: string, text: string, replyTo?: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return false
  const payload: Record<string, unknown> = { from: mailFrom(), to, subject, text }
  if (replyTo) payload.reply_to = replyTo
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    console.error('[mail] resend', res.status, await res.text().catch(() => ''))
    return false
  }
  return true
}

export async function sendAlertEmail(
  to: string,
  subject: string,
  text: string,
  extra?: { replyTo?: string }
): Promise<boolean> {
  if (!to) {
    console.log(`[mail] skip to=${to} subject=${subject}`)
    return false
  }
  try {
    if (process.env.SMTP_SERVER?.trim() && process.env.SMTP_USER?.trim()) {
      const ok = await smtpSend(to, subject, text, extra?.replyTo)
      if (ok) return true
    }
    const ok = await resendSend(to, subject, text, extra?.replyTo)
    if (ok) return true
    console.log(`[mail] skip to=${to} subject=${subject}`)
    return false
  } catch (e: any) {
    console.error('[mail]', e?.message ?? e)
    return false
  }
}
