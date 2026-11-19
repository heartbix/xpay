'use client'

import React from 'react'
import Link from 'next/link'
import styles from '@/styles/Home.module.css'

export type HeaderAccount = {
  name?: string
  email?: string
}

export function SiteHeader({
  active,
  account,
  onLogOff
}: {
  active: 'home' | 'account' | 'legal' | 'support'
  account?: HeaderAccount | null
  onLogOff?: () => void
}) {
  const signedIn = Boolean(account?.email || account?.name)
  return (
    <div className={styles.topbar}>
      <header className={styles.header}>
        <div className={styles.brandLockup}>
          <Link href="/" className={styles.brandLink} aria-label="XPay home">
            <img src="/xpay-mark.svg" alt="" width={36} height={36} className={styles.logo} />
            <span className={styles.brandText}>
              <strong>XPay</strong>
              <small>HeartBix</small>
            </span>
          </Link>
          <a
            className={styles.alphBadge}
            href="https://alephium.org"
            target="_blank"
            rel="noreferrer"
            title="Alephium network"
          >
            <img src="/alephium-logo.svg" alt="" width={18} height={18} />
            <span>on Alephium</span>
          </a>
        </div>
        <nav className={styles.nav}>
          <Link href="/" className={active === 'home' ? styles.navActive : styles.navLink}>
            Home
          </Link>
          <Link href="/account" className={active === 'account' ? styles.navActive : styles.navLink}>
            Account
          </Link>
          <Link href="/support" className={active === 'support' ? styles.navActive : styles.navLink}>
            Support
          </Link>
          {signedIn ? (
            <div className={styles.userMenu}>
              <div className={styles.userMeta}>
                {account?.name ? <strong>{account.name}</strong> : null}
                {account?.email ? <small title={account.email}>{account.email}</small> : null}
              </div>
              {onLogOff ? (
                <button type="button" className={styles.logOff} onClick={onLogOff}>
                  Log off
                </button>
              ) : null}
            </div>
          ) : active !== 'account' ? (
            <Link href="/account" className={styles.navCta}>
              Log in
            </Link>
          ) : null}
        </nav>
      </header>
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBrand}>
        <div className={styles.footerPair} aria-label="XPay × Alephium">
          <Link href="/" className={styles.footerBrandItem}>
            <img src="/xpay-mark.svg" alt="" width={40} height={40} />
            <span>XPay</span>
          </Link>
          <span className={styles.footerTimes} aria-hidden>
            ×
          </span>
          <a
            href="https://alephium.org"
            target="_blank"
            rel="noreferrer"
            className={styles.footerBrandItem}
          >
            <img src="/alephium-logo.svg" alt="" width={40} height={40} />
            <span>Alephium</span>
          </a>
        </div>
        <p>
          © {new Date().getFullYear()} HeartBix
          <span className={styles.footerDot}>•</span>
          <Link href="/terms">Terms of Service</Link>
          <span className={styles.footerDot}>•</span>
          <Link href="/privacy">Privacy Policy</Link>
          <span className={styles.footerDot}>•</span>
          <Link href="/support">Support</Link>
          <span className={styles.footerDot}>•</span>
          <a href="https://alephium.org" target="_blank" rel="noreferrer">
            alephium.org
          </a>
        </p>
      </div>
    </footer>
  )
}
