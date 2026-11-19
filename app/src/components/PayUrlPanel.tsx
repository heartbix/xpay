'use client'

import React, { useState } from 'react'
import styles from '@/styles/Home.module.css'

function formatMusdt(atomic: string): string {
  const n = BigInt(atomic || '0')
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

type Quote = {
  path: string
  slug: string
  payTo: string
  description: string
  priceAtomic: string
  feeAtomic: string
  totalAtomic: string
  buyerAlph: string
  balanceAtomic: string
}

type Paid = {
  ok: true
  txId: string
  slug: string
  payTo: string
  payer: string
  totalAtomic: string
  priceAtomic: string
  feeAtomic: string
}

export function PayUrlPanel({
  token,
  onPaid
}: {
  token: string
  onPaid: () => void
}) {
  const [url, setUrl] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [paid, setPaid] = useState<Paid | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const loadQuote = async () => {
    setBusy('quote')
    setError('')
    setPaid(null)
    try {
      const res = await fetch(`/api/hub/x402/pay-url?url=${encodeURIComponent(url.trim())}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `quote_${res.status}`)
      setQuote(data)
    } catch (e: any) {
      setQuote(null)
      setError(e?.message ?? 'quote_failed')
    } finally {
      setBusy('')
    }
  }

  const pay = async () => {
    setBusy('pay')
    setError('')
    try {
      const res = await fetch('/api/hub/x402/pay-url', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `pay_${res.status}`)
      setPaid(data)
      onPaid()
    } catch (e: any) {
      setError(e?.message ?? 'pay_failed')
    } finally {
      setBusy('')
    }
  }

  const short = (error: string) => {
    if (error === 'self_pay') return 'You cannot pay your own endpoint.'
    if (error === 'insufficient_balance') return 'Not enough USDT. Fund first, then pay.'
    if (error === 'merchant_not_found' || error === 'invalid_pay_url') return 'That is not a valid XPay pay URL.'
    if (error === 'public_key_missing') return 'This account is not ready to pay yet. Fund USDT once, then retry.'
    return error
  }

  return (
    <div className={styles.stack}>
      <p className={styles.kicker}>Pay</p>
      <h1 className={styles.pageTitle}>Pay a seller URL</h1>
      <p className={styles.lead}>
        Paste the seller’s x402 link. You pay from this login with your XPay USDT. No wallet extension.
      </p>
      <label className={styles.field}>
        <span>Pay URL</span>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setQuote(null)
            setPaid(null)
          }}
          placeholder="https://xpay.heartbix.com/api/pay/seller-alph/price1"
        />
      </label>
      <div className={styles.actions}>
        <button type="button" disabled={!!busy || url.trim().length < 8} onClick={() => void loadQuote()}>
          {busy === 'quote' ? 'Reading price…' : 'Read price'}
        </button>
      </div>
      {error ? <p className={styles.error}>{short(error)}</p> : null}
      {quote ? (
        <div className={styles.meta}>
          <div>
            <span>Catalog</span>
            <strong>{formatMusdt(quote.priceAtomic)} USDT</strong>
          </div>
          <div>
            <span>X402 fee</span>
            <strong>{formatMusdt(quote.feeAtomic)} USDT</strong>
          </div>
          <div>
            <span>You pay</span>
            <strong>{formatMusdt(quote.totalAtomic)} USDT</strong>
          </div>
          <div>
            <span>Your balance</span>
            <strong>{formatMusdt(quote.balanceAtomic)} USDT</strong>
          </div>
          <div>
            <span>Seller</span>
            <strong className={styles.mono}>{quote.payTo}</strong>
          </div>
          <div>
            <span>Slug</span>
            <strong>{quote.slug}</strong>
          </div>
        </div>
      ) : null}
      {quote?.description ? <p className={styles.sectionLead}>{quote.description}</p> : null}
      {quote ? (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!!busy || BigInt(quote.balanceAtomic || '0') < BigInt(quote.totalAtomic || '0')}
            onClick={() => void pay()}
          >
            {busy === 'pay' ? 'Paying…' : `Pay ${formatMusdt(quote.totalAtomic)} USDT`}
          </button>
        </div>
      ) : null}
      {paid ? (
        <p className={styles.feeLine}>
          Paid. Tx {paid.txId}. Check X402 transactions for sent.
        </p>
      ) : null}
    </div>
  )
}
