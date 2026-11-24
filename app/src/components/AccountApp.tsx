'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import styles from '@/styles/Home.module.css'
import { SupportCards } from './DocsPage'
import { SiteFooter, SiteHeader } from './SiteChrome'
import { ChartRange, OverviewChart } from './OverviewChart'
import { X402FeeLine } from './X402Cost'
import { PayUrlPanel } from './PayUrlPanel'
import { PlatformPanel } from './PlatformPanel'
import {
  DepositAddressResponse,
  HubAlert,
  HubApiKey,
  HubChain,
  HubDeposit,
  HubDestination,
  HubFeeQuote,
  HubMerchant,
  HubPayout,
  HubSettings,
  HubX402Payment
} from '@/lib/hub'

const SESSION_KEY = 'alph_x402_session'

type DashPage = 'overview' | 'account' | 'fund' | 'pay' | 'history' | 'api' | 'x402' | 'support' | 'platform'

const DASH_ITEMS: { id: DashPage; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'account', label: 'Account' },
  { id: 'fund', label: 'Fund' },
  { id: 'pay', label: 'Pay' },
  { id: 'x402', label: 'X402 Endpoint' },
  { id: 'history', label: 'X402 transactions' },
  { id: 'api', label: 'API' },
  { id: 'support', label: 'Support' }
]

function isDashPage(value: string): value is DashPage {
  return value === 'platform' || value === 'support' || DASH_ITEMS.some((item) => item.id === value)
}

type MeResponse = {
  userId: string
  email?: string
  name?: string
  alphAddress?: string
  deposits: HubDeposit[]
  apiKeys: HubApiKey[]
  merchants: HubMerchant[]
  balanceAtomic?: string
  feeQuote?: HubFeeQuote
  alerts?: HubAlert[]
  payouts?: HubPayout[]
  x402Payments?: HubX402Payment[]
  destinations?: HubDestination[]
  settings?: HubSettings
  minDepositUsdt?: number
  isAdmin?: boolean
  payoutsEnabled?: boolean
}

async function hubApi<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init
  const nextHeaders = new Headers(headers)
  if (!nextHeaders.has('Content-Type') && rest.body) nextHeaders.set('Content-Type', 'application/json')
  if (token) nextHeaders.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`/api/hub${path}`, { ...rest, headers: nextHeaders, cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error ?? `request_failed_${res.status}`)
  return data as T
}

function authErrorMessage(code: string): string {
  if (code === 'password_mismatch') return 'Passwords do not match.'
  if (code === 'password_too_short') return 'Password must be at least 8 characters.'
  if (code === 'email_taken') return 'That email already has an account. Log in instead.'
  if (code === 'invalid_credentials') return 'Email or password is incorrect.'
  if (code === 'invalid_email') return 'Enter a valid email address.'
  if (code === 'email_not_verified') return 'Confirm your email first. We sent a code and a link.'
  if (code === 'email_pending_verification') return 'This email is waiting for confirmation. Use the same password, or enter the code we sent.'
  if (code === 'invalid_verification') return 'That code or link is not valid.'
  if (code === 'verification_expired') return 'That confirmation expired. Send a new code.'
  if (code === 'verify_rate_limited') return 'Wait a minute before requesting another email.'
  if (code === 'already_verified') return 'That email is already confirmed. Log in.'
  return code
}

/** Hub rows are strings, but legacy/probe data can hold junk like "[object Object]". */
function toAtomic(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim())
  return 0n
}

function formatMusdt(atomic: unknown): string {
  const n = toAtomic(atomic)
  const whole = n / 1_000_000n
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

function sumAtomic(rows: HubDeposit[]): string {
  let n = 0n
  for (const row of rows) n += toAtomic(row.netAtomic ?? row.amountAtomic)
  return formatMusdt(n.toString())
}

function feeHint(quote?: HubFeeQuote, kind: 'x402' | 'withdraw' = 'x402'): string {
  if (!quote) return ''
  const amount = formatMusdt(quote.totalUsdtAtomic)
  if (kind === 'withdraw') return `Withdraw fee ${amount} USDT`
  if (toAtomic(quote.totalUsdtAtomic) === 0n) return ''
  return `Current X402 transaction fee ${amount} USDT`
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
  if (
    txId.startsWith('xp') ||
    txId.startsWith('pending') ||
    txId.startsWith('sim') ||
    txId.startsWith('0xsim')
  ) {
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

function TxLink({ href, label }: { href: string; label: string }) {
  return (
    <a className={styles.txLink} href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  )
}

function merchantPayUrl(m: { payTo?: string; slug: string; resourcePath?: string }): string {
  if (m.resourcePath) return `https://xpay.heartbix.com${m.resourcePath}`
  if (m.payTo) return `https://xpay.heartbix.com/api/pay/${m.payTo}/${m.slug}`
  return `https://xpay.heartbix.com/api/pay/${m.slug}`
}

const CHEAP_WITHDRAW_FALLBACK = 'base'

async function cheapestWithdrawChain(
  chainIds: string[],
  amountAtomic: string,
  token?: string
): Promise<string> {
  const ids = chainIds.length ? chainIds : ['base', 'arbitrum', 'bsc', 'polygon', 'ethereum']
  const quotes = await Promise.all(
    ids.map(async (id) => {
      try {
        const q = amountAtomic ? `&amountAtomic=${amountAtomic}` : ''
        const quote = await hubApi<HubFeeQuote>(
          `/fees/quote?kind=withdraw&chain=${encodeURIComponent(id)}${q}`,
          token ? { token } : {}
        )
        return { id, fee: toAtomic(quote.totalUsdtAtomic) }
      } catch {
        return { id, fee: 1n << 60n }
      }
    })
  )
  quotes.sort((a, b) => (a.fee < b.fee ? -1 : a.fee > b.fee ? 1 : 0))
  return quotes[0]?.id || CHEAP_WITHDRAW_FALLBACK
}

function withdrawSplit(amount: string, quote?: HubFeeQuote) {
  const n = Number(amount || '0')
  const gross = BigInt(Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : 0)
  const network = toAtomic(quote?.gasUsdtAtomic) + toAtomic(quote?.sweepUsdtAtomic)
  const vault = toAtomic(quote?.platformUsdtAtomic)
  const fee = toAtomic(quote?.totalUsdtAtomic)
  const net = gross > fee ? gross - fee : 0n
  return { gross, network, vault, fee, net }
}

/** Mirrors HUB_PAYOUT_DEST_WAIT_MS (24h) so the UI can show when a wallet unlocks. */
const DEST_WAIT_MS = 24 * 60 * 60 * 1000

function destinationStatus(createdAt: string): { ready: boolean; label: string } {
  const age = Date.now() - Date.parse(createdAt)
  if (!Number.isFinite(age)) return { ready: false, label: 'Pending' }
  const left = DEST_WAIT_MS - age
  if (left <= 0) return { ready: true, label: 'Ready' }
  const hours = Math.ceil(left / (60 * 60 * 1000))
  return { ready: false, label: hours <= 1 ? 'Ready in under 1h' : `Ready in ${hours}h` }
}

function matchesX402Search(row: HubX402Payment, query: string): boolean {
  if (!query) return true
  const hay = [row.txId, row.slug, row.direction, row.priceAtomic, row.feeAtomic, row.totalAtomic, row.id]
    .join(' ')
    .toLowerCase()
  return hay.includes(query)
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

function X402Speed({
  createdAt,
  httpMs,
  chainAt,
  txId,
  chainStatus
}: {
  createdAt: string
  httpMs?: number
  chainAt?: string
  txId?: string
  chainStatus?: 'pending' | 'settled' | 'failed'
}) {
  const pay = httpMs != null ? formatDurationMs(httpMs) : null
  const chainMs = chainAt ? Date.parse(chainAt) - Date.parse(createdAt) : null
  const chain =
    chainStatus === 'failed'
      ? 'receipt failed'
      : chainMs != null && Number.isFinite(chainMs)
        ? formatDurationMs(chainMs)
        : chainStatus === 'pending' || txId?.startsWith('pending')
          ? 'on-chain…'
          : null
  if (!pay && !chain) return <>—</>
  return (
    <span className={styles.speedCell}>
      {pay ? <span>{pay}</span> : null}
      {chain ? (
        <span className={styles.speedNote}>
          {chain === 'on-chain…' || chain === 'receipt failed' ? chain : pay ? `${chain} on-chain` : chain}
        </span>
      ) : null}
    </span>
  )
}

function X402TxCell({ txId, chainStatus }: { txId?: string; chainStatus?: 'pending' | 'settled' | 'failed' }) {
  if (chainStatus === 'failed') return <>Receipt failed</>
  if (txId && paymentTxHref(txId)) return <TxLink href={paymentTxHref(txId)!} label={txId} />
  return <>{txId || '—'}</>
}

export function AccountApp() {
  const searchParams = useSearchParams()
  const [token, setToken] = useState<string | null>(null)
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyMailed, setVerifyMailed] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [me, setMe] = useState<MeResponse | null>(null)
  const [meAt, setMeAt] = useState<number | null>(null)
  const [chains, setChains] = useState<HubChain[]>([])
  const [chain, setChain] = useState('bsc')
  const [depositAddr, setDepositAddr] = useState<DepositAddressResponse | null>(null)
  const [keyName, setKeyName] = useState('default')
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [slug, setSlug] = useState('')
  const [price, setPrice] = useState('0.001')
  const [description, setDescription] = useState('USDT micropayment via XPay x402')
  const [tokenSymbol, setTokenSymbol] = useState('USDT')
  const [oauthProviders, setOauthProviders] = useState<string[]>([])
  const [txQuery, setTxQuery] = useState('')
  const [page, setPage] = useState<DashPage>('overview')
  const [chartRange, setChartRange] = useState<ChartRange>('1d')
  const [chartNow, setChartNow] = useState(() => Date.now())
  const [fundModal, setFundModal] = useState<null | 'deposit' | 'withdraw' | 'addresses'>(null)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawChain, setWithdrawChain] = useState(CHEAP_WITHDRAW_FALLBACK)
  const [withdrawChainManual, setWithdrawChainManual] = useState(false)
  const [withdrawToken, setWithdrawToken] = useState('USDT')
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [destLabel, setDestLabel] = useState('')
  const [destChain, setDestChain] = useState('ethereum')
  const [destToken, setDestToken] = useState('USDT')
  const [destAddress, setDestAddress] = useState('')
  const [saveOnWithdraw, setSaveOnWithdraw] = useState(true)
  const [withdrawDestId, setWithdrawDestId] = useState('')
  const [lowAlert, setLowAlert] = useState(true)
  const [lowThreshold, setLowThreshold] = useState('10')
  const [payoutOn, setPayoutOn] = useState(false)
  const [payoutThreshold, setPayoutThreshold] = useState('100')
  const [payoutChain, setPayoutChain] = useState('ethereum')
  const [payoutAddress, setPayoutAddress] = useState('')
  const [payoutToken, setPayoutToken] = useState('USDT')
  const [withdrawQuote, setWithdrawQuote] = useState<HubFeeQuote | undefined>()
  const [ops, setOps] = useState<any>(null)
  const [opsBusy, setOpsBusy] = useState(false)
  const [opsKind, setOpsKind] = useState<'all' | 'x402' | 'deposit'>('all')
  const [platformTab, setPlatformTab] = useState<'dashboard' | 'history' | 'holders' | 'volume' | 'monitor'>(
    'dashboard'
  )
  const [opsQuery, setOpsQuery] = useState('')
  const [opsHistKind, setOpsHistKind] = useState<'all' | 'x402' | 'deposit' | 'payout'>('all')

  useEffect(() => {
    if (searchParams.get('mode') === 'register') setMode('register')
  }, [searchParams])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthToken = params.get('token')
    const oauthError = params.get('oauth')
    if (params.get('mode') === 'register') setMode('register')
    const verifyToken = params.get('verifyToken')
    if (verifyToken) {
      setBusy('auth')
      hubApi<{ token: string }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken })
      })
        .then((session) => {
          localStorage.setItem(SESSION_KEY, session.token)
          setToken(session.token)
          window.history.replaceState({}, '', '/account')
        })
        .catch((e: any) => {
          setMode('verify')
          setError(authErrorMessage(e?.message ?? 'invalid_verification'))
          window.history.replaceState({}, '', '/account')
        })
        .finally(() => setBusy(''))
    }
    if (oauthToken) {
      localStorage.setItem(SESSION_KEY, oauthToken)
      setToken(oauthToken)
      window.history.replaceState({}, '', '/account')
    } else if (oauthError) {
      setError(oauthError === 'not_configured' ? 'That login provider is not configured yet.' : oauthError)
      window.history.replaceState({}, '', '/account')
    } else {
      const saved = localStorage.getItem(SESSION_KEY)
      if (saved) setToken(saved)
    }
    hubApi<{ providers: string[] }>('/auth/providers')
      .then((data) => setOauthProviders(data.providers ?? []))
      .catch(() => setOauthProviders([]))
    const hash = window.location.hash.replace('#', '')
    if (isDashPage(hash)) setPage(hash)
  }, [])

  const refresh = useCallback(async (sessionToken: string) => {
    const [profile, chainRes] = await Promise.all([
      hubApi<MeResponse>('/me', { token: sessionToken }),
      hubApi<{ chains: HubChain[] }>('/chains')
    ])
    setMe(profile)
    setMeAt(Date.now())
    setChains(chainRes.chains)
    if (profile.settings) {
      setLowAlert(profile.settings.lowBalanceAlert)
      setLowThreshold(formatMusdt(profile.settings.lowBalanceThresholdAtomic))
      setPayoutOn(profile.settings.payoutEnabled)
      setPayoutThreshold(formatMusdt(profile.settings.payoutThresholdAtomic))
      setPayoutChain(profile.settings.payoutChain)
      setPayoutAddress(profile.settings.payoutAddress)
      setPayoutToken('USDT')
      const savedWithdraw = profile.settings.payoutAddress
      setWithdrawAddress((cur) => cur || savedWithdraw)
      setWithdrawToken('USDT')
    }
  }, [])

  useEffect(() => {
    if (!token) return
    refresh(token).catch((e) => {
      localStorage.removeItem(SESSION_KEY)
      setToken(null)
      setMe(null)
      setError(e?.message ?? 'session_expired')
    })
  }, [token, refresh])

  useEffect(() => {
    if (!token) return
    const ms =
      page === 'history'
        ? 3000
        : page === 'overview' && chartRange === '5m'
          ? 5000
          : page === 'overview' && chartRange === '1h'
            ? 15_000
            : 60_000
    const timer = window.setInterval(() => {
      refresh(token).catch(() => {})
    }, ms)
    return () => window.clearInterval(timer)
  }, [token, refresh, page, chartRange])

  useEffect(() => {
    if (page !== 'overview') return
    const ms = chartRange === '5m' ? 1000 : chartRange === '1h' ? 5000 : 30_000
    setChartNow(Date.now())
    const timer = window.setInterval(() => setChartNow(Date.now()), ms)
    return () => window.clearInterval(timer)
  }, [page, chartRange])

  useEffect(() => {
    if (!token) return
    const quoteChain = fundModal === 'withdraw' ? withdrawChain : payoutChain
    const n = Number(withdrawAmount)
    const amountAtomic =
      Number.isFinite(n) && n > 0 ? String(Math.round(n * 1_000_000)) : ''
    const q = amountAtomic ? `&amountAtomic=${amountAtomic}` : ''
    hubApi<HubFeeQuote>(`/fees/quote?kind=withdraw&chain=${encodeURIComponent(quoteChain)}${q}`, { token })
      .then(setWithdrawQuote)
      .catch(() => setWithdrawQuote(undefined))
  }, [token, payoutChain, withdrawChain, withdrawAmount, page, fundModal])

  useEffect(() => {
    if (fundModal !== 'withdraw' || withdrawChainManual || withdrawDestId) return
    let stop = false
    const n = Number(withdrawAmount)
    const amountAtomic =
      Number.isFinite(n) && n > 0 ? String(Math.round(n * 1_000_000)) : '1000000'
    cheapestWithdrawChain(
      chains.map((c) => c.id),
      amountAtomic,
      token || undefined
    ).then((id) => {
      if (!stop) setWithdrawChain(id)
    })
    return () => {
      stop = true
    }
  }, [fundModal, withdrawChainManual, withdrawDestId, withdrawAmount, chains, token])

  useEffect(() => {
    if (!fundModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFundModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fundModal])

  useEffect(() => {
    if (!token || !me?.isAdmin || page !== 'platform') return
    let stop = false
    const load = (showBusy: boolean) => {
      if (showBusy) setOpsBusy(true)
      hubApi('/admin/platform', { token })
        .then((data) => {
          if (!stop) setOps(data)
        })
        .catch((e: any) => {
          if (!stop) setError(e?.message ?? 'ops_failed')
        })
        .finally(() => {
          if (!stop && showBusy) setOpsBusy(false)
        })
    }
    load(true)
    const timer = window.setInterval(() => load(false), 3000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [token, me?.isAdmin, page])

  const onAuth = async (path: '/auth/login' | '/auth/register') => {
    setBusy('auth')
    setError('')
    try {
      if (path === '/auth/register' && password !== confirmPassword) {
        throw new Error('password_mismatch')
      }
      const session = await hubApi<{ token?: string; needsVerification?: boolean; mailed?: boolean; email?: string }>(
        path,
        {
          method: 'POST',
          body: JSON.stringify(
            path === '/auth/register' ? { email, password, confirmPassword } : { email, password }
          )
        }
      )
      if (path === '/auth/register' || session.needsVerification) {
        setVerifyMailed(session.mailed !== false)
        setMode('verify')
        setPassword('')
        setConfirmPassword('')
        return
      }
      if (!session.token) throw new Error('auth_failed')
      localStorage.setItem(SESSION_KEY, session.token)
      setToken(session.token)
      setPassword('')
      setConfirmPassword('')
    } catch (e: any) {
      const code = e?.message ?? 'auth_failed'
      if (code === 'email_not_verified' || code === 'email_pending_verification') {
        setMode('verify')
      }
      setError(authErrorMessage(code))
    } finally {
      setBusy('')
    }
  }

  const onVerify = async () => {
    setBusy('auth')
    setError('')
    try {
      const session = await hubApi<{ token: string }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code: verifyCode })
      })
      localStorage.setItem(SESSION_KEY, session.token)
      setToken(session.token)
      setVerifyCode('')
    } catch (e: any) {
      setError(authErrorMessage(e?.message ?? 'invalid_verification'))
    } finally {
      setBusy('')
    }
  }

  const onResendVerify = async () => {
    setBusy('auth')
    setError('')
    try {
      const result = await hubApi<{ mailed?: boolean }>('/auth/resend-verify', {
        method: 'POST',
        body: JSON.stringify({ email })
      })
      setVerifyMailed(result.mailed !== false)
    } catch (e: any) {
      setError(authErrorMessage(e?.message ?? 'resend_failed'))
    } finally {
      setBusy('')
    }
  }

  const onLogout = async () => {
    if (token) {
      try {
        await hubApi('/auth/logout', { method: 'POST', token })
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(SESSION_KEY)
    setToken(null)
    setMe(null)
    setDepositAddr(null)
    setNewSecret(null)
    setTxQuery('')
    setPage('overview')
    setWithdrawChain(CHEAP_WITHDRAW_FALLBACK)
    setWithdrawChainManual(false)
    setWithdrawDestId('')
    setFundModal(null)
  }

  const onDepositAddress = async (nextChain = chain, nextToken = tokenSymbol) => {
    if (!token) return
    setBusy('deposit')
    setError('')
    try {
      const row = await hubApi<DepositAddressResponse>('/deposits/address', {
        method: 'POST',
        token,
        body: JSON.stringify({ chain: nextChain, token: nextToken })
      })
      setDepositAddr(row)
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'deposit_address_failed')
    } finally {
      setBusy('')
    }
  }

  const onCreateKey = async () => {
    if (!token) return
    setBusy('key')
    setError('')
    setNewSecret(null)
    try {
      const row = await hubApi<HubApiKey & { secret: string }>('/keys', {
        method: 'POST',
        token,
        body: JSON.stringify({ name: keyName || 'default' })
      })
      setNewSecret(row.secret)
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'create_key_failed')
    } finally {
      setBusy('')
    }
  }

  const onRevokeKey = async (id: string) => {
    if (!token) return
    setBusy(`revoke-${id}`)
    try {
      await hubApi(`/keys/${id}`, { method: 'DELETE', token })
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'revoke_failed')
    } finally {
      setBusy('')
    }
  }

  const onCreateMerchant = async () => {
    if (!token) return
    setBusy('merchant')
    setError('')
    try {
      const priceAtomic = String(BigInt(Math.round(Number(price || '0') * 1_000_000)))
      await hubApi('/merchants', {
        method: 'POST',
        token,
        body: JSON.stringify({
          slug,
          priceAtomic,
          description
        })
      })
      setSlug('')
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'merchant_failed')
    } finally {
      setBusy('')
    }
  }

  const payoutError = (code: string) => {
    if (code === 'insufficient_balance') return 'Not enough credited balance.'
    if (code === 'below_min_withdraw') return 'Minimum withdraw is 1 USDT.'
    if (code === 'amount_too_small_for_fees') {
      return 'Amount must be greater than the withdraw fee.'
    }
    if (code === 'invalid_address') return 'Enter a valid 0x address.'
    if (code === 'withdraw_usdt_only') return 'Withdraw is USDT only.'
    if (code === 'treasury_usdt_short') {
      return 'Treasury is still moving USDT to that network. Try again shortly.'
    }
    if (code === 'payouts_locked') return 'Withdrawals are paused.'
    if (code === 'destination_not_saved') {
      return 'Save this wallet under Addresses first. It can receive a withdrawal 24 hours after you save it.'
    }
    if (code === 'destination_cooling_down') {
      return 'This wallet is still in its 24-hour safety hold. Check the Status column under Addresses to see when it unlocks.'
    }
    if (code === 'test_account_no_payout') {
      return 'This is a demo account. Demo balances can pay x402 URLs but cannot be withdrawn.'
    }
    if (code === 'payout_rate_limited') return 'Wait 15 minutes between withdraws.'
    if (code === 'forbidden_origin' || code === 'session_required') {
      return 'Withdraw from the XPay account page while signed in.'
    }
    return code
  }

  const onPayout = async (params: { amount: string; chain: string; token: string; toAddress: string }) => {
    if (!token) return
    setBusy('withdraw')
    setError('')
    try {
      const row = await hubApi<HubPayout>('/payouts', {
        method: 'POST',
        token,
        body: JSON.stringify({
          amountUsdt: params.amount,
          chain: params.chain,
          token: params.token,
          toAddress: params.toAddress
        })
      })
      if (row.status === 'failed') setError(row.error || 'withdraw_failed')
      else setFundModal(null)
      await refresh(token)
    } catch (e: any) {
      setError(payoutError(e?.message ?? 'withdraw_failed'))
    } finally {
      setBusy('')
    }
  }

  const onWithdraw = async () => {
    if (me && me.payoutsEnabled === false) {
      setError('Withdrawals are paused.')
      return
    }
    const dest = me?.destinations?.find((d) => d.id === withdrawDestId)
    if (!dest?.address) {
      setError('Pick a saved wallet first. New wallets can receive a withdrawal 24 hours after you save them.')
      return
    }
    const status = destinationStatus(dest.createdAt)
    if (!status.ready) {
      setError(`This wallet is still in its 24-hour safety hold — ${status.label.toLowerCase()}.`)
      return
    }
    await onPayout({
      amount: withdrawAmount,
      chain: withdrawChain,
      token: 'USDT',
      toAddress: dest.address
    })
  }

  const onSaveDestination = async () => {
    if (!token) return
    setBusy('dest')
    setError('')
    try {
      await hubApi('/destinations', {
        method: 'POST',
        token,
        body: JSON.stringify({
          label: destLabel.trim() || 'Wallet',
          chain: destChain,
          token: 'USDT',
          address: destAddress.trim()
        })
      })
      setDestLabel('')
      setDestAddress('')
      await refresh(token)
    } catch (e: any) {
      setError(payoutError(e?.message ?? 'save_address_failed'))
    } finally {
      setBusy('')
    }
  }

  const onDeleteDestination = async (id: string) => {
    if (!token) return
    setBusy(`deld-${id}`)
    try {
      await hubApi(`/destinations/${id}`, { method: 'DELETE', token })
      if (withdrawDestId === id) setWithdrawDestId('')
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'delete_failed')
    } finally {
      setBusy('')
    }
  }

  const onSaveSettings = async () => {
    if (!token) return
    setBusy('settings')
    setError('')
    try {
      await hubApi('/me/settings', {
        method: 'POST',
        token,
        body: JSON.stringify({
          lowBalanceAlert: lowAlert,
          lowBalanceThresholdUsdt: lowThreshold,
          payoutEnabled: payoutOn,
          payoutThresholdUsdt: payoutThreshold,
          payoutChain,
          payoutAddress,
          payoutToken: 'USDT'
        })
      })
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'settings_failed')
    } finally {
      setBusy('')
    }
  }

  const onDeleteMerchant = async (id: string) => {
    if (!token) return
    setBusy(`delm-${id}`)
    try {
      await hubApi(`/merchants/${id}`, { method: 'DELETE', token })
      await refresh(token)
    } catch (e: any) {
      setError(e?.message ?? 'delete_failed')
    } finally {
      setBusy('')
    }
  }

  const signedIn = !!token && !!me
  const profile = me
  const deposits = me?.deposits ?? []
  const credited = deposits.filter((d) => d.status === 'credited')
  const pending = deposits.filter((d) => d.status === 'detected' || d.status === 'confirmed')
  const failed = deposits.filter((d) => d.status === 'failed')
  const historyQuery = txQuery.trim().toLowerCase()
  const x402History = [...(me?.x402Payments ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((p) => matchesX402Search(p, historyQuery))

  const openPage = (next: DashPage) => {
    setPage(next)
    setError('')
    window.history.replaceState({}, '', `/account#${next}`)
  }

  const sideCounts: Partial<Record<DashPage, number>> = {
    history: me?.x402Payments?.length ?? 0,
    api: me?.apiKeys?.length ?? 0,
    x402: me?.merchants?.length ?? 0
  }
  const selectedChain = chains.find((c) => c.id === chain)
  const tokenOptions = (
    selectedChain?.tokens && selectedChain.tokens.length > 0
      ? selectedChain.tokens
      : [{ symbol: 'USDT', address: '', decimals: 6 }]
  ).filter((t) => t.symbol === 'USDT')

  return (
    <div className={styles.shell}>
      <SiteHeader
        active="account"
        account={signedIn && me ? { name: me.name, email: me.email } : null}
        onLogOff={signedIn ? onLogout : undefined}
      />
      <div className={styles.container}>

      {!signedIn ? (
        <section className={styles.rail}>
          <p className={styles.kicker}>Customer account</p>
          <h1 className={styles.title}>
            {mode === 'login' ? 'Log in' : mode === 'verify' ? 'Confirm email' : 'Create account'}
          </h1>
          <p className={styles.lead}>
            {mode === 'verify'
              ? `We sent a 6-digit code and a confirmation link to ${email || 'your email'}.`
              : 'Continue with Google, or use email and password. Then fund USDT, create API keys, and open an x402 receive endpoint.'}
          </p>
          {mode !== 'verify' ? (
          <div className={styles.oauth}>
            {oauthProviders.includes('google') ? (
              <a className={styles.oauthButton} href="/api/auth/google">
                Continue with Google
              </a>
            ) : null}
            {oauthProviders.includes('google') && <p className={styles.divider}>or</p>}
          </div>
          ) : null}
          {mode === 'verify' ? (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault()
                onVerify()
              }}
            >
              {!verifyMailed ? (
                <p className={styles.sectionLead}>The email could not be sent. Try Resend in a minute.</p>
              ) : null}
              <label className={styles.field}>
                <span>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className={styles.field}>
                <span>Confirmation code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 digits"
                  required
                />
              </label>
              <div className={styles.actions}>
                <button type="submit" disabled={!!busy || verifyCode.length !== 6}>
                  {busy === 'auth' ? 'Please wait…' : 'Confirm'}
                </button>
                <button type="button" className={styles.linkButton} disabled={!!busy} onClick={onResendVerify}>
                  Resend email
                </button>
              </div>
              <p className={styles.sectionLead}>
                <button type="button" className={styles.linkButton} onClick={() => setMode('login')}>
                  Back to log in
                </button>
              </p>
            </form>
          ) : (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault()
              onAuth(mode === 'login' ? '/auth/login' : '/auth/register')
            }}
          >
            <label className={styles.field}>
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            {mode === 'register' ? (
              <label className={styles.field}>
                <span>Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
            ) : null}
            <div className={styles.actions}>
              <button type="submit" disabled={!!busy}>
                {busy === 'auth' ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
              </button>
            </div>
          </form>
          )}
          {mode !== 'verify' ? (
          <p className={styles.sectionLead}>
            {mode === 'login' ? (
              <>
                No account yet?{' '}
                <button type="button" className={styles.linkButton} onClick={() => setMode('register')}>
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" className={styles.linkButton} onClick={() => setMode('login')}>
                  Log in
                </button>
              </>
            )}
          </p>
          ) : null}
        </section>
      ) : !profile ? (
        <section className={styles.rail}>
          <p className={styles.kicker}>Customer account</p>
          <h1 className={styles.title}>Loading your account…</h1>
          <p className={styles.lead}>Fetching your profile from the hub.</p>
          <div className={styles.actions}>
            <button type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </section>
      ) : (
        <div className={styles.dash}>
          <nav className={styles.side} aria-label="Dashboard">
            <p className={styles.sideLabel}>Menu</p>
            {(profile.isAdmin
              ? [...DASH_ITEMS, { id: 'platform' as const, label: 'Platform' }]
              : DASH_ITEMS
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                className={page === item.id ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
                onClick={() => openPage(item.id)}
              >
                <span>{item.label}</span>
                {sideCounts[item.id] !== undefined ? (
                  <span className={styles.sideCount}>{sideCounts[item.id]}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <section className={styles.rail}>
            {page === 'overview' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>Dashboard</p>
                <h1 className={styles.pageTitle}>Overview</h1>
                <p className={styles.lead}>
                  Fund, x402, and withdraw use USDT. Guides:{' '}
                  <a href="/support/x402">X402 payments</a> · <a href="/support/api">API</a>.
                </p>
                <X402FeeLine atomic={profile.feeQuote?.totalUsdtAtomic} />
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={busy === 'refresh'}
                    onClick={() => {
                      if (!token) return
                      setBusy('refresh')
                      refresh(token)
                        .catch((e: any) => setError(e?.message ?? 'refresh_failed'))
                        .finally(() => setBusy(''))
                    }}
                  >
                    {busy === 'refresh' ? 'Updating…' : 'Update balance'}
                  </button>
                </div>
                <p className={styles.feeLine}>
                  Updates every 1 minute{meAt ? ` · last ${new Date(meAt).toLocaleTimeString()}` : ''}. X402 activity is
                  pays on your endpoints. Fund deposits are USDT sent to a deposit address; pending is on-chain but not
                  credited yet.
                </p>
                <OverviewChart
                  payments={profile.x402Payments || []}
                  range={chartRange}
                  onRange={setChartRange}
                  now={chartNow}
                />
                <div className={styles.meta}>
                  <div>
                    <span>Balance</span>
                    <strong className={styles.statValue}>
                      {formatMusdt(profile.balanceAtomic || '0')} USDT
                    </strong>
                  </div>
                  <div>
                    <span>X402 transactions</span>
                    <strong className={styles.statValue}>{(profile.x402Payments || []).length}</strong>
                  </div>
                  <div>
                    <span>Pending deposits</span>
                    <strong className={styles.statValue}>{sumAtomic(pending)} USDT</strong>
                  </div>
                  <div>
                    <span>Fund deposits</span>
                    <strong className={styles.statValue}>{deposits.length}</strong>
                  </div>
                  <div>
                    <span>Credited deposits</span>
                    <strong className={styles.statValue}>{credited.length}</strong>
                  </div>
                  <div>
                    <span>Failed deposits</span>
                    <strong className={styles.statValue}>{failed.length}</strong>
                  </div>
                  <div>
                    <span>API keys</span>
                    <strong className={styles.statValue}>{profile.apiKeys.length}</strong>
                  </div>
                  <div>
                    <span>X402 endpoints</span>
                    <strong className={styles.statValue}>{profile.merchants.length}</strong>
                  </div>
                </div>
              </div>
            )}

            {page === 'platform' && (
              <PlatformPanel
                ops={ops}
                opsBusy={opsBusy}
                token={token}
                busy={busy}
                platformTab={platformTab}
                setPlatformTab={setPlatformTab}
                opsKind={opsKind}
                setOpsKind={setOpsKind}
                opsQuery={opsQuery}
                setOpsQuery={setOpsQuery}
                opsHistKind={opsHistKind}
                setOpsHistKind={setOpsHistKind}
                onRefresh={() => {
                  if (!token) return
                  setOpsBusy(true)
                  hubApi('/admin/platform', { token })
                    .then(setOps)
                    .catch((e: any) => setError(e?.message ?? 'ops_failed'))
                    .finally(() => setOpsBusy(false))
                }}
                onSimulate={async (kind) => {
                  if (!token) return
                  const busyKey = kind === 'deposit' ? 'simulate' : kind === 'x402' ? 'simulate-x402' : 'x402-live'
                  setBusy(busyKey)
                  try {
                    await hubApi('/admin/simulate', { method: 'POST', token, body: JSON.stringify({ kind }) })
                  } catch (e: any) {
                    setError(
                      e?.message === 'x402_live_in_progress'
                        ? 'A real X402 test is already running.'
                        : e?.message ?? 'simulate_failed'
                    )
                  } finally {
                    setBusy('')
                  }
                }}
              />
            )}

            {page === 'account' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>Account</p>
                <h1 className={styles.pageTitle}>Account</h1>
                <p className={styles.lead}>
                  Your login identity. A group-0 Alephium receive account is created automatically and linked to your
                  X402 endpoints.
                </p>
                <div className={styles.accountBlocks}>
                <section className={styles.accountBlock}>
                <h2 className={styles.sectionTitle}>Profile</h2>
                <div className={styles.meta}>
                  <div>
                    <span>Name</span>
                    <strong>{profile.name || '—'}</strong>
                  </div>
                  <div>
                    <span>Email</span>
                    <strong>{profile.email || '—'}</strong>
                  </div>
                </div>
                </section>

                <section className={styles.accountBlock}>
                <h2 className={styles.sectionTitle}>Low balance alert</h2>
                <p className={styles.sectionLead}>
                  Email {profile.email || 'your login email'} when available balance drops below the threshold.
                </p>
                <label className={styles.field}>
                  <span>Email alert</span>
                  <select value={lowAlert ? 'on' : 'off'} onChange={(e) => setLowAlert(e.target.value === 'on')}>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Low balance threshold (USDT)</span>
                  <input value={lowThreshold} onChange={(e) => setLowThreshold(e.target.value)} inputMode="decimal" />
                </label>
                <div className={styles.actions}>
                  <button type="button" disabled={!!busy} onClick={onSaveSettings}>
                    {busy === 'settings' ? 'Saving…' : 'Save alert'}
                  </button>
                </div>
                {(profile.alerts ?? []).filter((a) => a.kind === 'low_balance').length === 0 ? (
                  <p className={styles.empty}>No low-balance alerts yet.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Message</th>
                          <th>Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(profile.alerts ?? [])
                          .filter((a) => a.kind === 'low_balance')
                          .map((a) => (
                            <tr key={a.id}>
                              <td>{new Date(a.createdAt).toLocaleString()}</td>
                              <td>{a.message}</td>
                              <td>{a.emailed ? 'sent' : 'logged'}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                </section>

                <section className={styles.accountBlock}>
                <h2 className={styles.sectionTitle}>Auto-transfer</h2>
                <p className={styles.sectionLead}>
                  When credited balance is over the threshold, USDT is sent to your address. The withdraw fee is taken
                  from the amount.
                </p>
                {withdrawQuote ? <p className={styles.feeLine}>{feeHint(withdrawQuote, 'withdraw')}</p> : null}
                <label className={styles.field}>
                  <span>Auto-transfer</span>
                  <select value={payoutOn ? 'on' : 'off'} onChange={(e) => setPayoutOn(e.target.value === 'on')}>
                    <option value="off">Off</option>
                    <option value="on">On</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Threshold (USDT)</span>
                  <input
                    value={payoutThreshold}
                    onChange={(e) => setPayoutThreshold(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label className={styles.field}>
                  <span>Network</span>
                  <select value={payoutChain} onChange={(e) => setPayoutChain(e.target.value)}>
                    {(chains.length ? chains : [{ id: 'ethereum', name: 'Ethereum' }]).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Token</span>
                  <select value="USDT" disabled>
                    <option value="USDT">USDT</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Your receive address on that network</span>
                  <input
                    value={payoutAddress}
                    onChange={(e) => setPayoutAddress(e.target.value)}
                    placeholder="0x…"
                  />
                </label>
                <div className={styles.actions}>
                  <button type="button" disabled={!!busy} onClick={onSaveSettings}>
                    {busy === 'settings' ? 'Saving…' : 'Save auto-transfer'}
                  </button>
                </div>
                </section>
                </div>
              </div>
            )}

            {page === 'fund' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>Fund</p>
                <h1 className={styles.pageTitle}>Deposit or withdraw</h1>
                <p className={styles.lead}>
                  Deposit real USDT on a supported chain. Withdraw USDT to a saved wallet on any supported network.
                  HeartBix holds deposits in treasury and routes to the network you pick. Fees apply only when you
                  withdraw.
                </p>
                <div className={styles.tabs}>
                  <button
                    type="button"
                    className={fundModal === 'deposit' ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
                    onClick={() => {
                      setFundModal('deposit')
                      setChain('bsc')
                      void onDepositAddress('bsc', tokenSymbol)
                    }}
                  >
                    Deposit
                  </button>
                  <button
                    type="button"
                    className={fundModal === 'withdraw' ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
                    onClick={() => {
                      setFundModal('withdraw')
                      setWithdrawChainManual(false)
                    }}
                  >
                    Withdraw
                  </button>
                  <button
                    type="button"
                    className={fundModal === 'addresses' ? `${styles.sideBtn} ${styles.sideBtnActive}` : styles.sideBtn}
                    onClick={() => setFundModal('addresses')}
                  >
                    Addresses
                  </button>
                </div>
                {(profile.payouts ?? []).length > 0 && (
                  <>
                    <h2 className={styles.sectionTitle}>Withdraw history</h2>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Network</th>
                            <th>Gross</th>
                            <th>Fee</th>
                            <th>Sent</th>
                            <th>Status</th>
                            <th>Txid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(profile.payouts ?? []).map((p) => (
                            <tr key={p.id}>
                              <td>{new Date(p.createdAt).toLocaleString()}</td>
                              <td>
                                {p.chain} {p.token}
                              </td>
                              <td>{formatMusdt(p.amountAtomic)}</td>
                              <td>{formatMusdt(p.feeAtomic)}</td>
                              <td>{formatMusdt(p.netAtomic)}</td>
                              <td>{p.status}</td>
                              <td className={styles.mono}>
                                {p.txHash ? (
                                  evmExplorerTx(p.chain, p.txHash) ? (
                                    <TxLink href={evmExplorerTx(p.chain, p.txHash)!} label={p.txHash} />
                                  ) : (
                                    p.txHash
                                  )
                                ) : (
                                  p.error || '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                <h2 className={styles.sectionTitle}>Fund history</h2>
                {deposits.length === 0 ? (
                  <p className={styles.empty}>No deposits yet.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Chain</th>
                          <th>Token</th>
                          <th>Gross</th>
                          <th>Fee</th>
                          <th>Net</th>
                          <th>Status</th>
                          <th>Txid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...deposits]
                          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                          .map((d) => (
                            <tr key={d.id}>
                              <td>{new Date(d.createdAt).toLocaleString()}</td>
                              <td>{d.chain}</td>
                              <td>{d.token || 'USDT'}</td>
                              <td>
                                {d.amountUsdt} {d.token || 'USDT'}
                              </td>
                              <td>
                                {formatMusdt(d.feeAtomic || '0')} (gas {formatMusdt(d.gasFeeAtomic || '0')} + platform{' '}
                                {formatMusdt(d.platformFeeAtomic || d.gasFeeAtomic || '0')})
                              </td>
                              <td>
                                {formatMusdt(d.netAtomic || d.amountAtomic)} {d.token || 'USDT'}
                              </td>
                              <td>{d.status}</td>
                              <td className={styles.mono}>
                                {d.txHash && evmExplorerTx(d.chain, d.txHash) ? (
                                  <TxLink href={evmExplorerTx(d.chain, d.txHash)!} label={d.txHash} />
                                ) : (
                                  d.txHash
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {page === 'history' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>X402</p>
                <h1 className={styles.pageTitle}>X402 transactions</h1>
                <p className={styles.lead}>
                  Payments you sent or received on X402 endpoints. USDT credits in XPay; the Txid is a MockUSDT
                  transfer on Alephium testnet. Deposits and withdrawals stay in Fund.
                </p>
                {feeHint(profile.feeQuote) ? <p className={styles.feeLine}>{feeHint(profile.feeQuote)}</p> : null}
                <label className={styles.field}>
                  <span>Search</span>
                  <input
                    type="search"
                    value={txQuery}
                    onChange={(e) => setTxQuery(e.target.value)}
                    placeholder="txid, slug…"
                  />
                </label>
                {x402History.length === 0 ? (
                  <p className={styles.empty}>
                    {(profile.x402Payments ?? []).length === 0
                      ? 'No X402 transactions yet.'
                      : 'No payments match that search.'}
                  </p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Endpoint</th>
                          <th>Price</th>
                          <th>Fee</th>
                          <th>Total</th>
                          <th>Speed</th>
                          <th>Txid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {x402History.map((p) => (
                          <tr key={p.id}>
                            <td>{new Date(p.createdAt).toLocaleString()}</td>
                            <td>{p.direction === 'sent' ? 'Sent' : 'Received'}</td>
                            <td className={styles.mono}>{p.slug}</td>
                            <td>{formatMusdt(p.priceAtomic)} USDT</td>
                            <td>{formatMusdt(p.feeAtomic)} USDT</td>
                            <td>{formatMusdt(p.totalAtomic)} USDT</td>
                            <td>
                              <X402Speed
                                createdAt={p.createdAt}
                                httpMs={p.httpMs}
                                chainAt={p.chainAt}
                                txId={p.txId}
                                chainStatus={p.chainStatus}
                              />
                            </td>
                            <td className={styles.mono}>
                              <X402TxCell txId={p.txId} chainStatus={p.chainStatus} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {page === 'api' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>API</p>
                <h1 className={styles.pageTitle}>API keys</h1>
                <p className={styles.lead}>
                  Create a key for server-side clients. Send it as <code>x-api-key</code> to hub endpoints.
                </p>
                <label className={styles.field}>
                  <span>Name</span>
                  <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="production" />
                </label>
                <div className={styles.actions}>
                  <button type="button" disabled={!!busy} onClick={onCreateKey}>
                    {busy === 'key' ? 'Creating…' : 'Create API key'}
                  </button>
                </div>
                {newSecret && (
                  <div className={styles.statusBox}>
                    <p>Copy this secret now — it will not be shown again.</p>
                    <p className={styles.mono}>{newSecret}</p>
                  </div>
                )}
                {profile.apiKeys.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Prefix</th>
                          <th>Created</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {profile.apiKeys.map((k) => (
                          <tr key={k.id}>
                            <td>{k.name}</td>
                            <td className={styles.mono}>{k.keyPrefix}…</td>
                            <td>{new Date(k.createdAt).toLocaleString()}</td>
                            <td>
                              <button
                                type="button"
                                className={styles.linkButton}
                                disabled={!!busy}
                                onClick={() => onRevokeKey(k.id)}
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {page === 'pay' && token && (
              <PayUrlPanel token={token} onPaid={() => void refresh(token)} />
            )}

            {page === 'x402' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>X402 Endpoint</p>
                <h1 className={styles.pageTitle}>Receive payments</h1>
                <p className={styles.lead}>
                  Create a paid endpoint. The URL includes your group-0 Alephium account so the same slug (for example
                  price1) can exist for every seller. Share that URL. A buyer logs in and pays it from Pay.
                </p>
                <X402FeeLine atomic={profile.feeQuote?.totalUsdtAtomic} />
                <label className={styles.field}>
                  <span>Slug</span>
                  <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="price1" />
                </label>
                <label className={styles.field}>
                  <span>Price (USDT)</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.001"
                  />
                </label>
                <p className={styles.sectionLead}>
                  Default price for this slug; override per request with your API key.
                </p>
                <label className={styles.field}>
                  <span>Description</span>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={!!busy || slug.trim().length < 3 || !(Number(price) > 0)}
                    onClick={onCreateMerchant}
                  >
                    {busy === 'merchant' ? 'Saving…' : 'Create receive endpoint'}
                  </button>
                </div>
                <h2 className={styles.sectionTitle}>How to use</h2>
                <p className={styles.sectionLead}>
                  Call the URL. No payment → HTTP 402. Pay, then retry with the PAYMENT-SIGNATURE header. For an AI
                  request, your server sets the price with your API key (API page).
                </p>
                <pre className={styles.codeBox}>{`# Fixed price (catalog)
curl -i ${profile.merchants[0] ? merchantPayUrl(profile.merchants[0]) : `https://xpay.heartbix.com/api/pay/${profile.alphAddress || '<alph-address>'}/price1`}

# Per-request price, e.g. one AI call at 0.05 USDT (seller API key)
curl -i -H "x-api-key: YOUR_API_KEY" \\
  "${profile.merchants[0] ? merchantPayUrl(profile.merchants[0]) : `https://xpay.heartbix.com/api/pay/${profile.alphAddress || '<alph-address>'}/price1`}?price=0.05"

# After 402: retry the same URL with header
# PAYMENT-SIGNATURE: <base64 payment from the 402 body>`}</pre>
                {profile.merchants.length > 0 && (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>URL</th>
                          <th>Default price</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {profile.merchants.map((m) => (
                          <tr key={m.id}>
                            <td className={styles.mono}>{merchantPayUrl(m)}</td>
                            <td>{formatMusdt(m.priceAtomic)} USDT</td>
                            <td>
                              <button
                                type="button"
                                className={styles.linkButton}
                                disabled={!!busy}
                                onClick={() => onDeleteMerchant(m.id)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {page === 'support' && (
              <div className={styles.stack}>
                <p className={styles.kicker}>Support</p>
                <h1 className={styles.pageTitle}>Guides</h1>
                <p className={styles.lead}>
                  How XPay x402 payments work, and how to call the API. Opens the full Support pages.
                </p>
                <SupportCards />
              </div>
            )}
          </section>
        </div>
      )}

      {signedIn && fundModal && profile ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setFundModal(null)}
          role="presentation"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className={styles.modalClose} onClick={() => setFundModal(null)} aria-label="Close">
              ×
            </button>
            {fundModal === 'deposit' &&
              (() => {
                const chainLabel = chains.find((c) => c.id === chain)?.name || chain
                return (
                  <>
                    <h2 className={styles.modalTitle}>
                      Deposit {tokenSymbol} on {chainLabel}
                    </h2>
                    <p className={styles.modalLead}>
                      Send tokens to this address. The amount that arrives is credited. No deposit fee.
                    </p>
                    <div className={styles.modalRow}>
                      <label className={styles.field}>
                        <span>Token</span>
                        <select
                          value={tokenSymbol}
                          onChange={(e) => {
                            const next = e.target.value
                            setTokenSymbol(next)
                            void onDepositAddress(chain, next)
                          }}
                        >
                          {tokenOptions.map((t) => (
                            <option key={t.symbol} value={t.symbol}>
                              {t.symbol}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>On</span>
                        <select
                          value={chain}
                          onChange={(e) => {
                            const next = e.target.value
                            setChain(next)
                            void onDepositAddress(next, tokenSymbol)
                          }}
                        >
                          {(chains.length ? chains : [{ id: 'ethereum', name: 'Ethereum' }]).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className={styles.receiveBox}>
                      <div>
                        <span>Deposit address</span>
                        <strong className={styles.mono}>
                          {busy === 'deposit' ? 'Loading…' : depositAddr?.address || '—'}
                        </strong>
                      </div>
                      <div>
                        <span>Network</span>
                        <strong>
                          {depositAddr?.tokenSymbol || tokenSymbol} on {chainLabel}
                        </strong>
                      </div>
                      <div>
                        <span>Fee</span>
                        <strong>None on deposit</strong>
                      </div>
                    </div>
                    {depositAddr?.warning ? <p className={styles.error}>{depositAddr.warning}</p> : null}
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.hlPrimary}
                        disabled={!!busy || !depositAddr?.address}
                        onClick={() => {
                          if (!depositAddr?.address) return
                          void navigator.clipboard.writeText(depositAddr.address)
                        }}
                      >
                        Copy address
                      </button>
                    </div>
                  </>
                )
              })()}
            {fundModal === 'withdraw' &&
              (() => {
                const destinations = profile.destinations ?? []
                const dest = destinations.find((d) => d.id === withdrawDestId)
                const max = formatMusdt(profile.balanceAtomic || '0')
                const split = withdrawSplit(withdrawAmount, withdrawQuote)
                const chainLabel = (chains.find((c) => c.id === withdrawChain)?.name || withdrawChain)
                const toAddress = dest?.address || withdrawAddress
                const minAtomic = 1_000_000n
                const tooSmall =
                  split.gross > 0n && (split.gross < minAtomic || split.gross <= split.fee)
                return (
                  <>
                    <h2 className={styles.modalTitle}>
                      Withdraw USDT on {chainLabel}
                    </h2>
                    <p className={styles.modalLead}>
                      {profile.payoutsEnabled === false
                        ? 'Withdrawals are paused. You can still save a wallet address.'
                        : 'Withdraw USDT to a wallet you already saved. Fee is 2× dest gas; a small route extra applies only if treasury must hop onto this chain.'}
                    </p>
                    {profile.payoutsEnabled !== false && (
                      <p className={styles.modalLead}>
                        A wallet must be saved for 24 hours before it can receive a withdrawal. Check the Status column
                        under Addresses to see when each one unlocks.
                      </p>
                    )}
                    <div className={styles.modalRow}>
                      <label className={styles.field}>
                        <span>Token</span>
                        <select value="USDT" disabled>
                          <option value="USDT">USDT</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>On</span>
                        <select
                          value={withdrawChain}
                          onChange={(e) => {
                            setWithdrawChainManual(true)
                            setWithdrawChain(e.target.value)
                          }}
                        >
                          {(chains.length ? chains : [{ id: CHEAP_WITHDRAW_FALLBACK, name: 'Base' }]).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className={styles.field}>
                      <span>Amount</span>
                      <div className={styles.amountBox}>
                        <input
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                        <button type="button" className={styles.maxBtn} onClick={() => setWithdrawAmount(max)}>
                          MAX: {max} {withdrawToken}
                        </button>
                        <span className={styles.minHint}>
                          Min 1 USDT · fee {formatMusdt(split.fee.toString())} USDT
                          {toAtomic(withdrawQuote?.hopUsdtAtomic) > 0n ? ' (includes route)' : ''}
                        </span>
                      </div>
                    </label>
                    <label className={styles.field}>
                      <span>To</span>
                      <select
                        value={withdrawDestId}
                        onChange={(e) => {
                          const id = e.target.value
                          setWithdrawDestId(id)
                          const next = destinations.find((d) => d.id === id)
                          if (next) {
                            setWithdrawChainManual(true)
                            setWithdrawChain(next.chain)
                            setWithdrawToken(next.token)
                            setWithdrawAddress(next.address)
                          } else {
                            setWithdrawChainManual(false)
                            setWithdrawAddress('')
                          }
                        }}
                      >
                        <option value="">New address</option>
                        {destinations.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.label} · {d.address.slice(0, 6)}…{d.address.slice(-4)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!dest && (
                      <>
                        <label className={styles.field}>
                          <span>Recipient</span>
                          <input
                            value={withdrawAddress}
                            onChange={(e) => setWithdrawAddress(e.target.value)}
                            placeholder="0x…"
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Save as</span>
                          <input
                            value={destLabel}
                            onChange={(e) => setDestLabel(e.target.value)}
                            placeholder="My wallet"
                          />
                        </label>
                        <label className={styles.checkRow}>
                          <input
                            type="checkbox"
                            checked={saveOnWithdraw}
                            onChange={(e) => setSaveOnWithdraw(e.target.checked)}
                          />
                          Save this address
                        </label>
                      </>
                    )}
                    <div className={styles.receiveBox}>
                      <div>
                        <span>You will receive</span>
                        <strong>
                          {formatMusdt(split.net.toString())} {withdrawToken} on {chainLabel}
                        </strong>
                      </div>
                      <div>
                        <span>Withdraw fee</span>
                        <strong>
                          {formatMusdt(split.fee.toString())} USDT
                        </strong>
                      </div>
                      {tooSmall ? (
                        <p className={styles.error}>
                          Minimum 1 USDT, and more than the withdraw fee.
                        </p>
                      ) : null}
                      <div>
                        <span>Processing time</span>
                        <strong>~1–3 min</strong>
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.hlPrimary}
                        disabled={
                          profile.payoutsEnabled === false ||
                          !!busy ||
                          !(Number(withdrawAmount) > 0) ||
                          tooSmall ||
                          !dest
                        }
                        onClick={() => {
                          if (!toAddress) {
                            setError('Enter a recipient address or pick a saved wallet.')
                            return
                          }
                          if (tooSmall) return
                          onWithdraw()
                        }}
                      >
                        {profile.payoutsEnabled === false
                          ? 'Withdrawals paused'
                          : busy === 'withdraw'
                            ? 'Sending…'
                            : dest
                              ? 'Withdraw'
                              : 'Pick a saved wallet'}
                      </button>
                    </div>
                  </>
                )
              })()}
            {fundModal === 'addresses' && (
              <>
                <h2 className={styles.modalTitle}>Saved addresses</h2>
                <p className={styles.modalLead}>
                  Name wallets once, then pick them when you withdraw. A new address is held for 24 hours before it can
                  receive a withdrawal — that delay protects your balance if someone else gets into your account.
                </p>
                <label className={styles.field}>
                  <span>Label</span>
                  <input value={destLabel} onChange={(e) => setDestLabel(e.target.value)} placeholder="Trading wallet" />
                </label>
                <div className={styles.modalRow}>
                  <label className={styles.field}>
                    <span>Network</span>
                    <select value={destChain} onChange={(e) => setDestChain(e.target.value)}>
                      {(chains.length ? chains : [{ id: 'ethereum', name: 'Ethereum' }]).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Token</span>
                    <select value="USDT" disabled>
                      <option value="USDT">USDT</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>Address</span>
                  <input value={destAddress} onChange={(e) => setDestAddress(e.target.value)} placeholder="0x…" />
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.hlPrimary}
                    disabled={!!busy || !destAddress.trim()}
                    onClick={onSaveDestination}
                  >
                    {busy === 'dest' ? 'Saving…' : 'Save address'}
                  </button>
                </div>
                {(profile.destinations ?? []).length === 0 ? (
                  <p className={styles.empty}>No saved addresses yet.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th>Network</th>
                          <th>Token</th>
                          <th>Address</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(profile.destinations ?? []).map((d) => {
                          const status = destinationStatus(d.createdAt)
                          return (
                            <tr key={d.id}>
                              <td>{d.label}</td>
                              <td>{d.chain}</td>
                              <td>{d.token}</td>
                              <td className={styles.mono}>{d.address}</td>
                              <td>{status.label}</td>
                              <td>
                                <button
                                  type="button"
                                  className={styles.linkButton}
                                  disabled={!!busy}
                                  onClick={() => onDeleteDestination(d.id)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {error && <p className={styles.error}>{error}</p>}
      <SiteFooter />
      </div>
    </div>
  )
}
