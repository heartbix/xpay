'use client'

import React, { useState } from 'react'
import styles from '@/styles/Home.module.css'

const KINDS = [
  { id: 'idea', label: 'Idea' },
  { id: 'improvement', label: 'Improvement' },
  { id: 'issue', label: 'Issue' }
] as const

export function TicketForm() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('idea')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/hub/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name, email, message })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = String(data?.error ?? '')
        if (code === 'ticket_rate_limited') throw new Error('Too many tickets from this network. Try again later.')
        if (code === 'mail_failed') throw new Error('Could not send the ticket. Email xpay-ticket@heartbix.com.')
        if (code === 'message_too_short') throw new Error('Please write a bit more detail (at least 10 characters).')
        throw new Error(code || 'Could not send the ticket.')
      }
      setDone(true)
      setMessage('')
    } catch (err: any) {
      setError(err?.message ?? 'Could not send the ticket.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="ticket" className={styles.accountBlock}>
      <h2 className={styles.sectionTitle}>Raise an idea, improvement, or issue</h2>
      <p className={styles.sectionLead}>
        We read every ticket at xpay-ticket@heartbix.com. No login required.
      </p>
      {done ? (
        <p className={styles.feeLine}>Sent. We will reply to your email if we need more detail.</p>
      ) : (
        <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
          <label className={styles.field}>
            <span>Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className={styles.field}>
            <span>Message</span>
            <textarea
              required
              rows={6}
              minLength={10}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What should we add, improve, or fix?"
            />
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send ticket'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
