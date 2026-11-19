'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from '@/styles/Home.module.css'
import { SupportCards } from './DocsPage'
import { SiteFooter, SiteHeader } from './SiteChrome'
import { formatFeeUsdt } from './X402Cost'

type PublicStats = {
  x402Transactions: number
  x402VolumeAtomic: string
  chains: string[]
  minChargeUsdt: string
}

function formatUsdtShort(atomic: string): string {
  const n = BigInt(atomic || '0')
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toLocaleString()
}

export default function Home() {
  const [feeAtomic, setFeeAtomic] = useState<string | null>(null)
  const [stats, setStats] = useState<PublicStats | null>(null)
  useEffect(() => {
    fetch('/api/hub/fees/quote?kind=x402', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setFeeAtomic(String(d?.totalUsdtAtomic ?? '0')))
      .catch(() => setFeeAtomic('0'))
    fetch('/api/hub/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) =>
        setStats({
          x402Transactions: Number(d?.x402Transactions ?? 0),
          x402VolumeAtomic: String(d?.x402VolumeAtomic ?? '0'),
          chains: Array.isArray(d?.chains) ? d.chains.map(String) : [],
          minChargeUsdt: String(d?.minChargeUsdt ?? '0.001')
        })
      )
      .catch(() =>
        setStats({ x402Transactions: 0, x402VolumeAtomic: '0', chains: [], minChargeUsdt: '0.001' })
      )
  }, [])
  return (
    <div className={styles.shell}>
      <SiteHeader active="home" />
      <div className={styles.container}>
        <div className={styles.hero}>
          <p className={styles.kicker}>HeartBix · XPay on Alephium</p>
          <h1 className={styles.title}>
            Sell and pay USDT through <span className={styles.accent}>x402</span>.
          </h1>
          <p className={styles.lead}>
            One account. Sellers set a price and get paid. Buyers pay a seller URL. Auto-withdraw USDT to your wallet.
            Micropayments from {stats?.minChargeUsdt ?? '0.001'} USDT. Agents:{' '}
            <a href="/llms.txt">/llms.txt</a>.
          </p>
          <p className={styles.whyAlph}>
            Every x402 payment is saved on Alephium: on-chain, transparent, trustable, and traceable. Alephium’s
            low gas is what makes USDT micropayments possible.
          </p>
          <div className={styles.roleGrid}>
            <article className={`${styles.roleCard} ${styles.roleSeller}`}>
              <p className={styles.roleTag}>Seller</p>
              <h2>Create an account. Set your price. Get paid.</h2>
              <p>
                Publish an x402 URL, receive USDT on every pay, and auto-withdraw to the wallet you choose.
              </p>
              <ol>
                <li>Create your account</li>
                <li>Set your price and share the pay URL</li>
                <li>Get x402 payments in USDT</li>
                <li>Auto-withdraw to your wallet</li>
              </ol>
              <div className={styles.ctaRow}>
                <Link href="/account?mode=register" className={styles.navCta}>
                  Create seller account
                </Link>
                <Link href="/account" className={styles.navGhost}>
                  Log in
                </Link>
              </div>
            </article>
            <article className={`${styles.roleCard} ${styles.roleBuyer}`}>
              <p className={styles.roleTag}>Buyer</p>
              <h2>Create an account. Pay any x402 URL.</h2>
              <p>
                Log in, paste a seller link, and pay from this account. No wallet extension.
              </p>
              <ol>
                <li>Create your account</li>
                <li>Fund USDT on a supported chain</li>
                <li>Paste the seller x402 URL</li>
                <li>Pay the x402 transaction</li>
              </ol>
              <div className={styles.ctaRow}>
                <Link href="/account?mode=register" className={styles.navCta}>
                  Create buyer account
                </Link>
                <Link href="/account" className={styles.navGhost}>
                  Log in
                </Link>
              </div>
            </article>
          </div>
          <div className={styles.meta}>
            <div>
              <span>X402 transaction fee</span>
              <strong className={styles.statValue}>
                {feeAtomic !== null ? `${formatFeeUsdt(feeAtomic)} USDT` : '…'}
              </strong>
            </div>
            <div>
              <span>X402 transactions</span>
              <strong className={styles.statValue}>
                {stats ? stats.x402Transactions.toLocaleString() : '…'}
              </strong>
            </div>
            <div>
              <span>USDT paid</span>
              <strong className={styles.statValue}>
                {stats ? `${formatUsdtShort(stats.x402VolumeAtomic)} USDT` : '…'}
              </strong>
            </div>
            <div>
              <span>Charge from</span>
              <strong className={styles.statValue}>{stats?.minChargeUsdt ?? '0.001'} USDT</strong>
            </div>
          </div>
          <p className={styles.feeLine}>
            No wallet extension. Instant USDT credit. Deposit and withdraw on{' '}
            {stats?.chains.length ? stats.chains.join(', ') : 'Ethereum, BNB Smart Chain, Polygon, Arbitrum, Base'}.
          </p>
        </div>
        <div className={styles.rail}>
          <h2 className={styles.sectionTitle}>Support</h2>
          <p className={styles.sectionLead}>How x402 payments work, and how to call the API with examples.</p>
          <SupportCards />
        </div>
        <SiteFooter />
      </div>
    </div>
  )
}
