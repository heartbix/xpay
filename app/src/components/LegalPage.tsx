'use client'

import React from 'react'
import styles from '@/styles/Home.module.css'
import { SiteFooter, SiteHeader } from './SiteChrome'

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <SiteHeader active="legal" />
      <div className={styles.container}>
        <section className={styles.rail}>
          <p className={styles.kicker}>HeartBix · XPay</p>
          <h1 className={styles.pageTitle}>{title}</h1>
          <div className={styles.stack}>{children}</div>
        </section>
        <SiteFooter />
      </div>
    </div>
  )
}
