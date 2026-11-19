'use client'

import React from 'react'
import styles from '@/styles/Home.module.css'

/** Six USDT decimals so a ceiled micro like 0.000004 is visible. */
export function formatFeeUsdt(atomic: string | undefined): string {
  const n = BigInt(atomic || '0')
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0')
  return `${whole}.${frac}`
}

export function X402FeeLine({ atomic }: { atomic?: string }) {
  return (
    <p className={styles.feeLine}>
      X402 transaction fee = {formatFeeUsdt(atomic)} USDT
    </p>
  )
}
