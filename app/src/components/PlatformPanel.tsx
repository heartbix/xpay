'use client'

import React, { useEffect, useMemo, useState } from 'react'
import styles from '@/styles/Home.module.css'
import { ChartRange, OverviewChart } from '@/components/OverviewChart'

type Tab = 'dashboard' | 'history' | 'holders' | 'volume' | 'monitor'

function formatMusdt(atomic: string): string {
  const n = BigInt(atomic || '0')
  const neg = n < 0n
  const abs = neg ? -n : n
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  const body = frac ? `${whole}.${frac}` : whole.toString()
  return neg ? `-${body}` : body
}

function formatPnl(atomic: string): string {
  const n = BigInt(atomic || '0')
  const body = formatMusdt(n < 0n ? (-n).toString() : n.toString())
  if (n > 0n) return `+${body}`
  if (n < 0n) return `-${body}`
  return body
}

function eventAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'now'
  if (ms < 5000) return 'just now'
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  return new Date(iso).toLocaleString()
}

function alphExplorerTx(txId: string): string {
  const network = process.env.NEXT_PUBLIC_NETWORK
  const base = network === 'mainnet' ? 'https://explorer.alephium.org' : 'https://testnet.alephium.org'
  return `${base}/transactions/${txId}`
}

function paymentTxHref(txId: string): string | null {
  if (!txId) return null
  if (txId.startsWith('xp') || txId.startsWith('pending') || txId.startsWith('sim') || txId.startsWith('0xsim')) {
    return null
  }
  if (/^[0-9a-f]{64}$/i.test(txId)) return alphExplorerTx(txId)
  return null
}

function evmExplorerTx(chain: string, hash: string): string | null {
  const explorers: Record<string, string> = {
    ethereum: `https://etherscan.io/tx/${hash}`,
    bsc: `https://bscscan.com/tx/${hash}`,
    polygon: `https://polygonscan.com/tx/${hash}`,
    arbitrum: `https://arbiscan.io/tx/${hash}`,
    base: `https://basescan.org/tx/${hash}`
  }
  return explorers[chain] ?? null
}

function TxCell({ kind, chain, txId }: { kind?: string; chain?: string; txId?: string }) {
  if (!txId) return <>{'—'}</>
  const href =
    kind === 'x402' ? paymentTxHref(txId) : chain ? evmExplorerTx(chain, txId) : paymentTxHref(txId) || evmExplorerTx(chain || '', txId)
  if (href) {
    return (
      <a className={styles.txLink} href={href} target="_blank" rel="noreferrer">
        {txId}
      </a>
    )
  }
  return <span className={styles.mono}>{txId.slice(0, 18)}…</span>
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'history', label: 'Transactions' },
  { id: 'holders', label: 'Top USD holders' },
  { id: 'volume', label: 'Top paid + received' },
  { id: 'monitor', label: 'Monitoring' }
]

export function PlatformPanel({
  ops,
  opsBusy,
  token,
  busy,
  platformTab,
  setPlatformTab,
  opsKind,
  setOpsKind,
  opsQuery,
  setOpsQuery,
  opsHistKind,
  setOpsHistKind,
  onRefresh,
  onSimulate
}: {
  ops: any
  opsBusy: boolean
  token: string | null
  busy: string
  platformTab: Tab
  setPlatformTab: (t: Tab) => void
  opsKind: 'all' | 'x402' | 'deposit'
  setOpsKind: (k: 'all' | 'x402' | 'deposit') => void
  opsQuery: string
  setOpsQuery: (q: string) => void
  opsHistKind: 'all' | 'x402' | 'deposit' | 'payout'
  setOpsHistKind: (k: 'all' | 'x402' | 'deposit' | 'payout') => void
  onRefresh: () => void
  onSimulate: (kind: 'deposit' | 'x402' | 'x402-live') => void
}) {
  const [chartRange, setChartRange] = useState<ChartRange>('1d')
  const [chartNow, setChartNow] = useState(() => Date.now())

  useEffect(() => {
    if (platformTab !== 'history') return
    const ms = chartRange === '5m' ? 1000 : chartRange === '1h' ? 5000 : 30_000
    setChartNow(Date.now())
    const timer = window.setInterval(() => setChartNow(Date.now()), ms)
    return () => window.clearInterval(timer)
  }, [platformTab, chartRange])

  const history = (ops?.history ?? []) as any[]
  const chartRows = useMemo(
    () =>
      history.map((row) => ({
        createdAt: String(row.at || ''),
        direction: String(row.direction || ''),
        priceAtomic: String(row.amountAtomic || '0')
      })),
    [history]
  )
  const filtered = history.filter((row) => {
    if (opsHistKind !== 'all' && row.kind !== opsHistKind) return false
    if (!opsQuery.trim()) return true
    const q = opsQuery.toLowerCase()
    return [row.kind, row.direction, row.label, row.detail, row.status, row.txId, row.amountAtomic, row.chain, row.feeAtomic, row.costAtomic]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
  const pnlSum = filtered.reduce(
    (acc, row) => {
      acc.fee += BigInt(row.feeAtomic || '0')
      acc.cost += BigInt(row.costAtomic || '0')
      acc.pnl += BigInt(row.pnlAtomic || '0')
      return acc
    },
    { fee: 0n, cost: 0n, pnl: 0n }
  )

  return (
    <div className={styles.stack}>
      <p className={styles.kicker}>Platform</p>
      <h1 className={styles.pageTitle}>Operations</h1>
      <p className={styles.lead}>Admin snapshot. Dashboard is gas and treasury. Transactions is full history.</p>
      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={platformTab === t.id ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
            onClick={() => setPlatformTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.liveBar}>
        <span className={styles.liveDot} aria-hidden />
        <strong>Live</strong>
        <span>{opsBusy && !ops ? 'Connecting…' : 'Watching hub events'}</span>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={opsBusy || !token} onClick={onRefresh}>
          {opsBusy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!ops ? (
        <p className={styles.empty}>{opsBusy ? 'Loading platform snapshot…' : 'No snapshot yet.'}</p>
      ) : platformTab === 'dashboard' ? (
        <>
          {(ops.warnings ?? []).length > 0 ? (
            <div className={styles.statusBox}>
              {(ops.warnings as string[]).map((w) => (
                <p key={w} className={styles.error}>
                  {w}
                </p>
              ))}
            </div>
          ) : (
            <p className={styles.feeLine}>No gas or node warnings.</p>
          )}
          <div className={styles.meta}>
            <div>
              <span>Network</span>
              <strong>{ops.network}</strong>
            </div>
            <div>
              <span>Watch</span>
              <strong>{(ops.watchChains ?? []).join(', ') || '—'}</strong>
            </div>
            <div>
              <span>Auto sweep / credit</span>
              <strong>
                {ops.autoSweep ? 'on' : 'off'} / {ops.autoCredit ? 'on' : 'off'}
              </strong>
            </div>
            <div>
              <span>Users</span>
              <strong className={styles.statValue}>{ops.books?.users ?? 0}</strong>
            </div>
            <div>
              <span>User liabilities</span>
              <strong>{formatMusdt(ops.books?.userLiabilitiesAtomic || '0')} USDT</strong>
            </div>
            <div>
              <span>Platform gains</span>
              <strong>{formatMusdt(ops.gains?.totalAtomic || '0')} USDT</strong>
            </div>
            <div>
              <span>X402 fee quote</span>
              <strong>{formatMusdt(ops.fees?.x402?.totalUsdtAtomic || '0')} USDT</strong>
            </div>
            <div>
              <span>X402 volume</span>
              <strong>{formatMusdt(ops.books?.x402VolumeAtomic || '0')} USDT</strong>
            </div>
          </div>
          <h2 className={styles.sectionTitle}>Gains</h2>
          <div className={styles.meta}>
            <div>
              <span>X402 fees</span>
              <strong>{formatMusdt(ops.gains?.x402FeesAtomic || '0')} USDT</strong>
            </div>
            <div>
              <span>Withdraw fees</span>
              <strong>{formatMusdt(ops.gains?.withdrawFeesAtomic || '0')} USDT</strong>
            </div>
            <div>
              <span>Deposit fees</span>
              <strong>{formatMusdt(ops.gains?.depositFeesAtomic || '0')} USDT</strong>
            </div>
            <div>
              <span>Vault ALPH recoup</span>
              <strong>{ops.fees?.vaultAlph ?? '—'} ALPH</strong>
            </div>
            <div>
              <span>Deposits credited</span>
              <strong>
                {ops.books?.creditedDeposits ?? 0} / {ops.books?.deposits ?? 0}
              </strong>
            </div>
            <div>
              <span>X402 transactions</span>
              <strong>{ops.books?.x402Payments ?? 0}</strong>
            </div>
          </div>
          <h2 className={styles.sectionTitle}>Gas by network</h2>
          <p className={styles.sectionLead}>
            Sweep and payout wallet: <span className={styles.mono}>{ops.treasury || 'unconfigured'}</span>. Keep native
            gas on each chain so sweeps and withdraws can pay fees.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Network</th>
                  <th>Gas</th>
                  <th>USDT</th>
                  <th>USDC</th>
                  <th>Withdraw fee</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(ops.chains ?? []).map((c: any) => {
                  const usdt = (c.tokens ?? []).find((t: any) => t.symbol === 'USDT')
                  const usdc = (c.tokens ?? []).find((t: any) => t.symbol === 'USDC')
                  return (
                    <tr key={c.chain}>
                      <td>{c.name}</td>
                      <td>
                        {c.native} {c.nativeSymbol}
                        {c.nativeLow ? ' · low' : ''}
                      </td>
                      <td>{usdt?.amount ?? '—'}</td>
                      <td>{usdc?.amount ?? '—'}</td>
                      <td>${Number(c.withdrawFeeUsd ?? 0).toFixed(2)}</td>
                      <td>{c.error || (c.nativeLow ? 'fund gas' : 'ok')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <h2 className={styles.sectionTitle}>Alephium</h2>
          {ops.alph ? (
            <div className={styles.meta}>
              <div>
                <span>Hub address</span>
                <strong className={styles.mono}>{ops.alph.address}</strong>
              </div>
              <div>
                <span>ALPH</span>
                <strong>
                  {ops.alph.alph}
                  {ops.alph.alphLow ? ' · low' : ''}
                </strong>
              </div>
              <div>
                <span>Locked ALPH</span>
                <strong>{ops.alph.alphLocked}</strong>
              </div>
              <div>
                <span>MockUSDT</span>
                <strong>{ops.alph.musdt}</strong>
              </div>
              <div>
                <span>PaymentVault</span>
                <strong className={styles.mono}>{ops.alph.vaultAddress}</strong>
              </div>
              <div>
                <span>Network</span>
                <strong>{ops.alph.network}</strong>
              </div>
            </div>
          ) : (
            <p className={styles.empty}>Alephium snapshot unavailable.</p>
          )}
        </>
      ) : platformTab === 'history' ? (
        <>
          <OverviewChart
            payments={chartRows}
            range={chartRange}
            onRange={setChartRange}
            now={chartNow}
            title="Activity"
            tag="Platform"
            receivedLabel="In (received + deposits)"
            paidLabel="Out (paid + withdraws)"
            empty="No platform transactions in this window."
          />
          <p className={styles.sectionLead}>
            Last {filtered.length} matching rows (newest first). About 20 fit on screen; scroll for the rest. Fee is
            what XPay charged (x402 = 2× gas). Cost is hop + on-chain gas. PnL is fee minus cost.
          </p>
          <div className={styles.meta}>
            <div>
              <span>Fee taken</span>
              <strong>{formatMusdt(pnlSum.fee.toString())} USDT</strong>
            </div>
            <div>
              <span>Cost</span>
              <strong>{formatMusdt(pnlSum.cost.toString())} USDT</strong>
            </div>
            <div>
              <span>PnL</span>
              <strong className={pnlSum.pnl >= 0n ? styles.pnlUp : styles.pnlDown}>
                {formatPnl(pnlSum.pnl.toString())} USDT
              </strong>
            </div>
          </div>
          <div className={styles.tabs}>
            {(['all', 'x402', 'deposit', 'payout'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={opsHistKind === k ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
                onClick={() => setOpsHistKind(k)}
              >
                {k === 'all' ? 'All' : k === 'x402' ? 'X402' : k === 'deposit' ? 'Deposits' : 'Withdraws'}
              </button>
            ))}
          </div>
          <label className={styles.field}>
            <span>Search</span>
            <input
              type="search"
              value={opsQuery}
              onChange={(e) => setOpsQuery(e.target.value)}
              placeholder="email, slug, tx, status…"
            />
          </label>
          <div className={`${styles.tableWrap} ${styles.scrollTable}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th>Detail</th>
                  <th>USDT</th>
                  <th>Fee</th>
                  <th>Cost</th>
                  <th>PnL</th>
                  <th>Status</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10}>No matching transactions.</td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td>{new Date(row.at).toLocaleString()}</td>
                      <td>
                        {row.kind}
                        {row.direction ? ` · ${row.direction}` : ''}
                      </td>
                      <td>{row.label}</td>
                      <td>{row.detail}</td>
                      <td>{formatMusdt(row.amountAtomic || '0')}</td>
                      <td>{formatMusdt(row.feeAtomic || '0')}</td>
                      <td>
                        {formatMusdt(row.costAtomic || '0')}
                        {row.kind === 'payout' && BigInt(row.hopAtomic || '0') > 0n ? (
                          <span className={styles.costSplit}>
                            hop {formatMusdt(row.hopAtomic)} + gas {formatMusdt(row.gasAtomic || '0')}
                          </span>
                        ) : null}
                        {row.kind === 'x402' && BigInt(row.costAtomic || '0') > 0n ? (
                          <span className={styles.costSplit}>1× ALPH gas</span>
                        ) : null}
                      </td>
                      <td className={BigInt(row.pnlAtomic || '0') >= 0n ? styles.pnlUp : styles.pnlDown}>
                        {formatPnl(row.pnlAtomic || '0')}
                      </td>
                      <td>{row.status}</td>
                      <td className={styles.mono}>
                        <TxCell kind={row.kind} chain={row.chain} txId={row.txId} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : platformTab === 'holders' ? (
        <>
          <p className={styles.sectionLead}>XPay USDT balances, largest first.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Account</th>
                  <th>USDT</th>
                </tr>
              </thead>
              <tbody>
                {(ops.topHolders ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3}>None</td>
                  </tr>
                ) : (
                  (ops.topHolders ?? []).map((row: any, i: number) => (
                    <tr key={row.userId}>
                      <td>{i + 1}</td>
                      <td>{row.label}</td>
                      <td>{formatMusdt(row.balanceAtomic || '0')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : platformTab === 'volume' ? (
        <>
          <p className={styles.sectionLead}>X402 paid (sent) and received USDT by account.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Account</th>
                  <th>Received</th>
                  <th>Paid</th>
                  <th>Total USDT</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {(ops.topPaidReceive ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6}>None</td>
                  </tr>
                ) : (
                  (ops.topPaidReceive ?? []).map((row: any, i: number) => (
                    <tr key={row.userId}>
                      <td>{i + 1}</td>
                      <td>{row.label}</td>
                      <td>
                        {formatMusdt(row.receivedAtomic || '0')} ({row.receivedCount ?? 0})
                      </td>
                      <td>
                        {formatMusdt(row.paidAtomic || '0')} ({row.paidCount ?? 0})
                      </td>
                      <td>{formatMusdt(row.totalAtomic || '0')}</td>
                      <td>{(row.receivedCount ?? 0) + (row.paidCount ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className={styles.sectionLead}>
            Simulate deposit or X402, or pay a real X402 (bourmatt@gmail.com → admin@heartbix.com). Live events below.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy === 'simulate'}
              onClick={() => {
                setOpsKind('deposit')
                onSimulate('deposit')
              }}
            >
              {busy === 'simulate' ? 'Starting…' : 'Simulate deposit'}
            </button>
            <button
              type="button"
              disabled={busy === 'simulate-x402'}
              onClick={() => {
                setOpsKind('x402')
                onSimulate('x402')
              }}
            >
              {busy === 'simulate-x402' ? 'Starting…' : 'Simulate X402'}
            </button>
            <button
              type="button"
              disabled={busy === 'x402-live'}
              onClick={() => {
                setOpsKind('x402')
                onSimulate('x402-live')
              }}
            >
              {busy === 'x402-live' ? 'Starting…' : 'Pay real X402'}
            </button>
          </div>
          <div className={styles.tabs}>
            {(['all', 'x402', 'deposit'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={opsKind === k ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
                onClick={() => setOpsKind(k)}
              >
                {k === 'all' ? 'All' : k === 'x402' ? 'X402' : 'Deposits'}
              </button>
            ))}
          </div>
          <div className={styles.activity}>
            {((ops.activity ?? []).filter((ev: any) => opsKind === 'all' || ev.kind === opsKind)).length === 0 ? (
              <p className={styles.empty}>No events yet. Use Simulate X402 or Simulate deposit.</p>
            ) : (
              (ops.activity ?? [])
                .filter((ev: any) => opsKind === 'all' || ev.kind === opsKind)
                .map((ev: any) => (
                  <div key={ev.id} className={styles.activityRow}>
                    <span className={styles.activityTime}>{eventAge(ev.at)}</span>
                    <strong>
                      {ev.title}
                      {ev.simulated ? ' · sim' : ''}
                    </strong>
                    <span>{ev.detail}</span>
                    <em>{ev.status}</em>
                    <TxCell kind={ev.kind} chain={ev.chain} txId={ev.txId} />
                  </div>
                ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
