'use client'

import React, { useMemo } from 'react'
import styles from '@/styles/Home.module.css'
export type ChartRange = '5m' | '1h' | '1d' | '1mo' | '1y'

export type ActivityChartRow = {
  createdAt: string
  direction?: string
  priceAtomic?: string
}

const DAY = 24 * 60 * 60_000

const RANGES: { id: ChartRange; label: string; span: number; bucket: number }[] = [
  { id: '5m', label: '5m', span: 5 * 60_000, bucket: 20_000 },
  { id: '1h', label: '1h', span: 60 * 60_000, bucket: 5 * 60_000 },
  { id: '1d', label: '1d', span: DAY, bucket: 60 * 60_000 },
  { id: '1mo', label: '1 month', span: 30 * DAY, bucket: DAY },
  { id: '1y', label: '1 year', span: 365 * DAY, bucket: 7 * DAY }
]

const PAID = '#34d399'
const RECV = '#3b82f6'

function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n < 0.01) return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  if (n < 10) return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function tickLabel(ts: number, range: ChartRange): string {
  const d = new Date(ts)
  if (range === '1mo' || range === '1y') {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  if (range === '5m') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function atomicUsd(atomic: string): number {
  const n = Number(atomic || '0')
  if (!Number.isFinite(n)) return 0
  return n / 1_000_000
}

function isPaid(row: ActivityChartRow): boolean {
  const d = row.direction || 'received'
  return d === 'sent' || d === 'paid' || d === 'out'
}

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0)
}

export function OverviewChart({
  payments,
  range,
  onRange,
  now,
  title = 'Activity',
  tag = 'X402',
  receivedLabel = 'Received',
  paidLabel = 'Paid',
  empty = 'No x402 transactions in this window.'
}: {
  payments: ActivityChartRow[]
  range: ChartRange
  onRange: (next: ChartRange) => void
  now: number
  title?: string
  tag?: string
  receivedLabel?: string
  paidLabel?: string
  empty?: string
}) {
  const spec = RANGES.find((r) => r.id === range) ?? RANGES[2]
  const series = useMemo(() => {
    const n = Math.ceil(spec.span / spec.bucket)
    const start = now - spec.span
    const paidCount = zeros(n)
    const recvCount = zeros(n)
    const paidVol = zeros(n)
    const recvVol = zeros(n)
    for (const row of payments) {
      const t = Date.parse(row.createdAt)
      if (!Number.isFinite(t) || t < start || t > now) continue
      let i = Math.floor((t - start) / spec.bucket)
      if (i < 0) continue
      if (i >= n) i = n - 1
      const usd = atomicUsd(row.priceAtomic || '0')
      if (isPaid(row)) {
        paidCount[i] += 1
        paidVol[i] += usd
      } else {
        recvCount[i] += 1
        recvVol[i] += usd
      }
    }
    const paidTx = paidCount.reduce((a, b) => a + b, 0)
    const recvTx = recvCount.reduce((a, b) => a + b, 0)
    const paidUsd = paidVol.reduce((a, b) => a + b, 0)
    const recvUsd = recvVol.reduce((a, b) => a + b, 0)
    return { n, start, paidCount, recvCount, paidVol, recvVol, paidTx, recvTx, paidUsd, recvUsd }
  }, [payments, spec, now])

  const W = 720
  const H = 420
  const padL = 44
  const padR = 16
  const padT = 22
  const midGap = 36
  const padB = 30
  const plotH = (H - padT - midGap - padB) / 2
  const topY = padT
  const botY = padT + plotH + midGap
  const innerW = W - padL - padR
  const maxC = Math.max(1, ...series.paidCount.map((v, i) => v + series.recvCount[i]))
  const maxV = Math.max(0.001, ...series.paidVol.map((v, i) => v + series.recvVol[i]))
  const xAt = (i: number) => padL + ((i + 0.5) / series.n) * innerW
  const barW = Math.max(3, (innerW / series.n) * 0.62)
  const yTop = (v: number) => topY + plotH - (v / maxC) * plotH
  const yBot = (v: number) => botY + plotH - (v / maxV) * plotH
  const tickEvery = series.n <= 12 ? 2 : series.n <= 16 ? 3 : series.n <= 31 ? 5 : 8
  const ticks = Array.from({ length: series.n }, (_, i) => i).filter(
    (i) => i === 0 || i === series.n - 1 || i % tickEvery === 0
  )

  const stacked = (
    key: string,
    i: number,
    paid: number,
    recv: number,
    yOf: (v: number) => number,
    baseY: number
  ) => {
    const total = paid + recv
    if (total <= 0) return null
    const yPaid = yOf(total)
    const yRecv = yOf(recv)
    const recvH = Math.max(0, baseY + plotH - yRecv)
    const paidH = Math.max(0, yRecv - yPaid)
    const x = xAt(i) - barW / 2
    return (
      <g key={key}>
        {recv > 0 ? <rect x={x} y={yRecv} width={barW} height={recvH} fill={RECV} rx="1.5" /> : null}
        {paid > 0 ? <rect x={x} y={yPaid} width={barW} height={paidH} fill={PAID} rx="1.5" /> : null}
      </g>
    )
  }

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHead}>
        <div>
          <div className={styles.chartTitleRow}>
            <h2 className={styles.sectionTitle}>{title}</h2>
            <span className={styles.chartTag}>{tag}</span>
          </div>
          <p className={styles.chartSummary}>
            {series.recvTx} received · {series.paidTx} paid · {formatUsd(series.recvUsd)} USD in ·{' '}
            {formatUsd(series.paidUsd)} USD out
          </p>
        </div>
        <div className={styles.chartTabs} role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              className={range === r.id ? styles.chartTabActive : undefined}
              onClick={() => onRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Paid and received pays and USD volume"
      >
        <text x={padL} y={topY - 8} fill="#94a3b8" fontSize="11">
          Transactions
        </text>
        <text x={W - padR} y={topY - 8} textAnchor="end" fill="#64748b" fontSize="10">
          {maxC}
        </text>
        <line x1={padL} y1={topY} x2={padL} y2={topY + plotH} stroke="rgba(148,163,184,0.28)" />
        <line x1={padL} y1={topY + plotH} x2={W - padR} y2={topY + plotH} stroke="rgba(148,163,184,0.28)" />
        {[0.5].map((p) => (
          <line
            key={`tg${p}`}
            x1={padL}
            y1={topY + plotH * (1 - p)}
            x2={W - padR}
            y2={topY + plotH * (1 - p)}
            stroke="rgba(148,163,184,0.1)"
          />
        ))}
        {series.recvCount.map((recv, i) => stacked(`c${i}`, i, series.paidCount[i], recv, yTop, topY))}

        <text x={padL} y={botY - 8} fill="#94a3b8" fontSize="11">
          USD volume
        </text>
        <text x={W - padR} y={botY - 8} textAnchor="end" fill="#64748b" fontSize="10">
          {formatUsd(maxV)}
        </text>
        <line x1={padL} y1={botY} x2={padL} y2={botY + plotH} stroke="rgba(148,163,184,0.28)" />
        <line x1={padL} y1={botY + plotH} x2={W - padR} y2={botY + plotH} stroke="rgba(148,163,184,0.28)" />
        {[0.5].map((p) => (
          <line
            key={`bg${p}`}
            x1={padL}
            y1={botY + plotH * (1 - p)}
            x2={W - padR}
            y2={botY + plotH * (1 - p)}
            stroke="rgba(148,163,184,0.1)"
          />
        ))}
        {series.recvVol.map((recv, i) => stacked(`v${i}`, i, series.paidVol[i], recv, yBot, botY))}

        {ticks.map((i) => (
          <text key={`t${i}`} x={xAt(i)} y={H - 8} textAnchor="middle" fill="#64748b" fontSize="10">
            {tickLabel(series.start + i * spec.bucket, range)}
          </text>
        ))}
      </svg>
      <div className={styles.chartLegend}>
        <span>
          <i className={styles.chartSwatch} style={{ background: RECV }} />
          {receivedLabel}
        </span>
        <span>
          <i className={styles.chartSwatch} style={{ background: PAID }} />
          {paidLabel}
        </span>
        {series.paidTx + series.recvTx === 0 ? <span>{empty}</span> : null}
      </div>
    </div>
  )
}
