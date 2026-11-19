'use client'

import React from 'react'
import Link from 'next/link'
import styles from '@/styles/Home.module.css'
import { SiteFooter, SiteHeader } from './SiteChrome'

export function SupportCards() {
  return (
    <div className={styles.processGrid}>
      <Link href="/support/x402" className={styles.docCard}>
        <strong>X402 payments</strong>
        <span>HTTP 402 USDT micropayments. Priced URL, instant XPay credit.</span>
      </Link>
      <Link href="/support/api" className={styles.docCard}>
        <strong>API, SDKs, MCP</strong>
        <span>Two-line JS/Python clients, XPay MCP, /llms.txt for agents.</span>
      </Link>
      <Link href="/support#ticket" className={styles.docCard}>
        <strong>Idea, improvement, issue</strong>
        <span>Send a ticket. It goes to xpay-ticket@heartbix.com.</span>
      </Link>
    </div>
  )
}

export function DocsPage({
  title,
  kicker = 'Support',
  current = 'index',
  children
}: {
  title: string
  kicker?: string
  current?: 'index' | 'x402' | 'api'
  children: React.ReactNode
}) {
  return (
    <div className={styles.shell}>
      <SiteHeader active="support" />
      <div className={styles.container}>
        <section className={styles.rail}>
          <p className={styles.kicker}>{kicker}</p>
          <h1 className={styles.pageTitle}>{title}</h1>
          <nav className={styles.ctaRow} aria-label="Support">
            <Link href="/support" className={current === 'index' ? styles.navActive : styles.navLink}>
              Support
            </Link>
            <Link href="/support/x402" className={current === 'x402' ? styles.navActive : styles.navLink}>
              X402 payments
            </Link>
            <Link href="/support/api" className={current === 'api' ? styles.navActive : styles.navLink}>
              API
            </Link>
          </nav>
          <div className={styles.stack}>{children}</div>
        </section>
        <SiteFooter />
      </div>
    </div>
  )
}
