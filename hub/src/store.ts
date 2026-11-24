import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { allocateGroup0Address, isDemoAlphAddress } from './alph-addresses'
import { SupportedChain, TokenSymbol } from './chains'

export type DepositAddress = {
  userId: string
  alphAddress?: string
  chain: SupportedChain
  address: string
  derivationIndex: number
  createdAt: string
}

export type DepositRecord = {
  id: string
  userId: string
  chain: SupportedChain
  token?: TokenSymbol
  txHash: string
  amountAtomic: string
  amountUsdt: string
  feeAtomic?: string
  gasFeeAtomic?: string
  platformFeeAtomic?: string
  sweepFeeAtomic?: string
  netAtomic?: string
  gasAlph?: string
  alphUsd?: string
  status: 'detected' | 'confirmed' | 'credited' | 'failed'
  creditTxId?: string
  sweepTxHash?: string
  costUsdtAtomic?: string
  sweepError?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type HubUser = {
  userId: string
  email?: string
  name?: string
  passwordHash?: string
  passwordSalt?: string
  googleId?: string
  githubId?: string
  alphAddress?: string
  alphGroup?: number
  alphDerivationIndex?: number
  lowBalanceAlert?: boolean
  lowBalanceThresholdAtomic?: string
  lastLowBalanceAlertAt?: string
  payoutEnabled?: boolean
  payoutThresholdAtomic?: string
  payoutChain?: SupportedChain
  payoutAddress?: string
  payoutToken?: TokenSymbol
  /** Seeded demo balance: can transact but never withdraw. */
  testMode?: boolean
  emailVerifiedAt?: string
  emailVerifyCodeHash?: string
  emailVerifyTokenHash?: string
  emailVerifyExpiresAt?: string
  lastVerifySentAt?: string
  createdAt: string
}

export type AlertRecord = {
  id: string
  userId: string
  kind: 'low_balance' | 'payout'
  message: string
  emailed: boolean
  createdAt: string
}

export type PayoutRecord = {
  id: string
  userId: string
  chain: SupportedChain
  token: TokenSymbol
  toAddress: string
  amountAtomic: string
  feeAtomic: string
  netAtomic: string
  gasAlph?: string
  alphUsd?: string
  status: 'scheduled' | 'sending' | 'sent' | 'failed'
  txHash?: string
  routeTxHash?: string
  hopUsdtAtomic?: string
  costUsdtAtomic?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type SavedDestination = {
  id: string
  userId: string
  label: string
  chain: SupportedChain
  token: TokenSymbol
  address: string
  createdAt: string
}

export type X402PaymentRecord = {
  id: string
  userId: string
  slug: string
  txId: string
  pendingTxId?: string
  direction?: 'sent' | 'received'
  payer?: string
  payTo?: string
  priceAtomic: string
  feeAtomic: string
  gasFeeAtomic?: string
  platformFeeAtomic?: string
  totalAtomic: string
  gasAlph?: string
  alphUsd?: string
  createdAt: string
  httpMs?: number
  chainAt?: string
  chainStatus?: 'pending' | 'settled' | 'failed'
  chainError?: string
  /**
   * Historical row kept for public stats only. It is excluded from every
   * balance calculation, so restoring old history cannot mint balance.
   */
  archived?: boolean
}

export type Session = {
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
}

export type ApiKeyRecord = {
  id: string
  userId: string
  name: string
  keyPrefix: string
  keyHash: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}

export type MerchantEndpoint = {
  id: string
  userId: string
  slug: string
  payTo: string
  priceAtomic: string
  description: string
  createdAt: string
  updatedAt: string
}

export type X402ChainJob = {
  id: string
  pendingTxId: string
  from: string
  to: string
  amount: string
  nonce: string
  deadline: string
  signature: string
  createdAt: string
  submittedTxId?: string
  attempts?: number
  lastError?: string
}

type DbShape = {
  nextIndex: number
  nextAlphIndex: number
  users: HubUser[]
  addresses: DepositAddress[]
  deposits: DepositRecord[]
  sessions: Session[]
  apiKeys: ApiKeyRecord[]
  merchants: MerchantEndpoint[]
  alerts: AlertRecord[]
  payouts: PayoutRecord[]
  x402Payments: X402PaymentRecord[]
  destinations: SavedDestination[]
  x402Nonces: Record<string, string>
  x402Queue: X402ChainJob[]
}

const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'hub.json')

function emptyDb(): DbShape {
  return {
    nextIndex: 0,
    nextAlphIndex: 0,
    users: [],
    addresses: [],
    deposits: [],
    sessions: [],
    apiKeys: [],
    merchants: [],
    alerts: [],
    payouts: [],
    x402Payments: [],
    destinations: [],
    x402Nonces: {},
    x402Queue: []
  }
}

/**
 * hub.json is ~12 MB and readDb() is called on nearly every request. Parsing it
 * each time saturates the event loop, so the parsed document is cached and only
 * re-read when the file's mtime/size changes (or after a local write).
 */
let dbCache: { db: DbShape; mtimeMs: number; size: number } | undefined

function readDb(): DbShape {
  let stat: fs.Stats
  try {
    stat = fs.statSync(DB_PATH)
  } catch {
    return emptyDb()
  }
  if (dbCache && dbCache.mtimeMs === stat.mtimeMs && dbCache.size === stat.size) {
    return dbCache.db
  }
  const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as Partial<DbShape>
  const db: DbShape = {
    ...emptyDb(),
    ...raw,
    nextAlphIndex: raw.nextAlphIndex ?? 0,
    sessions: raw.sessions ?? [],
    apiKeys: raw.apiKeys ?? [],
    merchants: raw.merchants ?? [],
    alerts: raw.alerts ?? [],
    payouts: raw.payouts ?? [],
    x402Payments: raw.x402Payments ?? [],
    destinations: raw.destinations ?? [],
    x402Nonces: raw.x402Nonces ?? {},
    x402Queue: raw.x402Queue ?? []
  }
  dbCache = { db, mtimeMs: stat.mtimeMs, size: stat.size }
  return db
}

const LOCK_DIR = `${DB_PATH}.lock`
const LOCK_STALE_MS = 30_000
const LOCK_WAIT_MS = 10_000

/**
 * Directory-based mutex. The previous version spun 2000 times with no delay,
 * which blocked the event loop and starved the HTTP server. This version backs
 * off between attempts and breaks locks left behind by a crashed process.
 */
function withLock<T>(fn: () => T): T {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(LOCK_DIR)
      try {
        return fn()
      } finally {
        try {
          fs.rmdirSync(LOCK_DIR)
        } catch {
          /* ignore */
        }
      }
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e
      // A lock older than LOCK_STALE_MS means the owner died mid-write.
      try {
        const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs
        if (age > LOCK_STALE_MS) {
          fs.rmdirSync(LOCK_DIR)
          continue
        }
      } catch {
        /* lock vanished between checks */
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    }
  }
  throw new Error('db_lock_timeout')
}

function writeDb(db: DbShape) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
  // Keep the cache in sync so the next readDb() does not re-parse 12 MB.
  try {
    const stat = fs.statSync(DB_PATH)
    dbCache = { db, mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    dbCache = undefined
  }
}

function updateDb<T>(fn: (db: DbShape) => T): T {
  return withLock(() => {
    const db = readDb()
    const result = fn(db)
    writeDb(db)
    return result
  })
}

export function upsertUser(userId: string, alphAddress?: string): HubUser {
  const db = readDb()
  let user = db.users.find((u) => u.userId === userId)
  if (!user) {
    user = { userId, alphAddress, createdAt: new Date().toISOString() }
    db.users.push(user)
  } else if (alphAddress) {
    user.alphAddress = alphAddress
  }
  writeDb(db)
  return user
}

export function createEmailUser(row: HubUser): HubUser {
  const db = readDb()
  db.users.push(row)
  writeDb(db)
  return row
}

export function findUserByEmail(email: string): HubUser | undefined {
  const normalized = email.trim().toLowerCase()
  return readDb().users.find((u) => u.email === normalized)
}

export function findUserByAlphAddress(address: string): HubUser | undefined {
  const addr = address.trim()
  if (!addr) return undefined
  return readDb().users.find((u) => u.alphAddress === addr)
}

export function findUserByVerifyTokenHash(tokenHash: string): HubUser | undefined {
  return readDb().users.find((u) => u.emailVerifyTokenHash === tokenHash)
}

export function findUserByGoogleId(googleId: string): HubUser | undefined {
  return readDb().users.find((u) => u.googleId === googleId)
}

export function findUserByGithubId(githubId: string): HubUser | undefined {
  return readDb().users.find((u) => u.githubId === githubId)
}

export function updateUser(userId: string, patch: Partial<HubUser>): HubUser | undefined {
  const db = readDb()
  const user = db.users.find((u) => u.userId === userId)
  if (!user) return undefined
  Object.assign(user, patch)
  writeDb(db)
  return user
}

export function getOrCreateDepositAddress(
  userId: string,
  chain: SupportedChain,
  deriveAddress: (index: number) => string
): DepositAddress {
  const db = readDb()
  const userRows = db.addresses.filter((a) => a.userId === userId)
  const existing = userRows.find((a) => a.chain === chain)
  const shared = userRows.find((a) => a.derivationIndex >= 0)
  const derivationIndex = shared?.derivationIndex ?? db.nextIndex
  if (!shared) db.nextIndex += 1
  const address = deriveAddress(derivationIndex)

  if (existing) {
    if (existing.address.toLowerCase() === address.toLowerCase() && existing.derivationIndex === derivationIndex) {
      return existing
    }
    existing.address = address
    existing.derivationIndex = derivationIndex
    writeDb(db)
    return existing
  }

  const row: DepositAddress = {
    userId,
    chain,
    address,
    derivationIndex,
    createdAt: new Date().toISOString()
  }
  db.addresses.push(row)
  writeDb(db)
  return row
}

/** Point every chain row for a user at one real HD address. */
export function unifyUserDepositAddress(
  userId: string,
  derivationIndex: number,
  address: string
): DepositAddress[] {
  const db = readDb()
  const rows = db.addresses.filter((a) => a.userId === userId)
  for (const row of rows) {
    row.address = address
    row.derivationIndex = derivationIndex
  }
  if (db.nextIndex <= derivationIndex) db.nextIndex = derivationIndex + 1
  writeDb(db)
  return rows
}

export function listAddresses(): DepositAddress[] {
  return readDb().addresses
}

export function findAddress(chain: SupportedChain, address: string): DepositAddress | undefined {
  return readDb().addresses.find((a) => a.chain === chain && a.address.toLowerCase() === address.toLowerCase())
}

export function listDeposits(userId?: string): DepositRecord[] {
  const rows = readDb().deposits
  return userId ? rows.filter((d) => d.userId === userId) : rows
}

export function findDepositByTx(chain: SupportedChain, txHash: string): DepositRecord | undefined {
  return readDb().deposits.find((d) => d.chain === chain && d.txHash.toLowerCase() === txHash.toLowerCase())
}

export function saveDeposit(row: DepositRecord): DepositRecord {
  const db = readDb()
  const idx = db.deposits.findIndex((d) => d.id === row.id)
  if (idx >= 0) db.deposits[idx] = row
  else db.deposits.push(row)
  writeDb(db)
  return row
}

export function getUser(userId: string): HubUser | undefined {
  return readDb().users.find((u) => u.userId === userId)
}

export function listUsers(): HubUser[] {
  return readDb().users
}

export function getNextAlphIndex(): number {
  return readDb().nextAlphIndex ?? 0
}

export function getNextEvmIndex(): number {
  return readDb().nextIndex ?? 0
}

/** Persist a pre-allocated real hub HD group-0 address (and rewrite this user's payTo URLs). */
export function assignUserAlphAddress(
  userId: string,
  address: string,
  derivationIndex: number
): { user: HubUser; oldAddress?: string } {
  const db = readDb()
  let user = db.users.find((u) => u.userId === userId)
  if (!user) {
    user = { userId, createdAt: new Date().toISOString() }
    db.users.push(user)
  }
  const oldAddress = user.alphAddress
  user.alphAddress = address
  user.alphGroup = 0
  user.alphDerivationIndex = derivationIndex
  if (db.nextAlphIndex <= derivationIndex) db.nextAlphIndex = derivationIndex + 1
  if (oldAddress && oldAddress !== address) {
    const now = new Date().toISOString()
    for (const merchant of db.merchants) {
      if (merchant.userId === userId && merchant.payTo === oldAddress) {
        merchant.payTo = address
        merchant.updatedAt = now
      }
    }
  }
  writeDb(db)
  return { user, oldAddress }
}

/** Allocate (or replace a leftover demo-phrase address with) a real hub HD group-0 address. */
export function reassignUserAlphAddress(userId: string): { user: HubUser; oldAddress?: string } {
  const allocated = allocateGroup0Address(getNextAlphIndex())
  return assignUserAlphAddress(userId, allocated.address, allocated.derivationIndex)
}

export function ensureUserAlphAddress(userId: string): HubUser {
  const db = readDb()
  let user = db.users.find((u) => u.userId === userId)
  if (!user) {
    user = { userId, createdAt: new Date().toISOString() }
    db.users.push(user)
    writeDb(db)
  }
  if (user.alphAddress && !isDemoAlphAddress(user.alphAddress)) return user
  return reassignUserAlphAddress(userId).user
}

export function saveSession(row: Session): Session {
  const db = readDb()
  const now = Date.now()
  db.sessions = db.sessions.filter((s) => Date.parse(s.expiresAt) > now && s.userId !== row.userId)
  db.sessions.push(row)
  writeDb(db)
  return row
}

export function findSessionByTokenHash(tokenHash: string): Session | undefined {
  const db = readDb()
  const now = Date.now()
  return db.sessions.find((s) => s.tokenHash === tokenHash && Date.parse(s.expiresAt) > now)
}

export function revokeSessions(userId: string) {
  const db = readDb()
  db.sessions = db.sessions.filter((s) => s.userId !== userId)
  writeDb(db)
}

export function revokeAllSessions(): number {
  const db = readDb()
  const n = db.sessions.length
  db.sessions = []
  writeDb(db)
  return n
}

export function revokeApiKeysForEmailUsers(emails: string[]): number {
  const want = new Set(emails.map((e) => e.trim().toLowerCase()))
  const db = readDb()
  const ids = new Set(
    db.users.filter((u) => u.email && want.has(u.email.trim().toLowerCase())).map((u) => u.userId)
  )
  const now = new Date().toISOString()
  let n = 0
  for (const key of db.apiKeys) {
    if (key.revokedAt) continue
    if (!ids.has(key.userId)) continue
    key.revokedAt = now
    n += 1
  }
  writeDb(db)
  return n
}

export function listApiKeys(userId: string): ApiKeyRecord[] {
  return readDb().apiKeys.filter((k) => k.userId === userId && !k.revokedAt)
}

export function createApiKey(row: ApiKeyRecord): ApiKeyRecord {
  return updateDb((db) => {
    db.apiKeys.push(row)
    return row
  })
}

export function revokeApiKey(userId: string, keyId: string): ApiKeyRecord | undefined {
  const db = readDb()
  const key = db.apiKeys.find((k) => k.id === keyId && k.userId === userId && !k.revokedAt)
  if (!key) return undefined
  key.revokedAt = new Date().toISOString()
  writeDb(db)
  return key
}

export function findApiKeyByHash(keyHash: string): ApiKeyRecord | undefined {
  return readDb().apiKeys.find((k) => k.keyHash === keyHash && !k.revokedAt)
}

export function touchApiKey(id: string) {
  const db = readDb()
  const key = db.apiKeys.find((k) => k.id === id)
  if (!key) return
  key.lastUsedAt = new Date().toISOString()
  writeDb(db)
}

export function payResourcePath(payTo: string, slug: string): string {
  return `/api/pay/${payTo}/${slug}`
}

export function listMerchants(userId: string): MerchantEndpoint[] {
  return readDb().merchants.filter((m) => m.userId === userId)
}

/** Public catalog for /.well-known/x402 — no emails, skip load-test accounts. */
export function listPublicPayResources(): {
  resource: string
  slug: string
  payTo: string
  priceAtomic: string
  description: string
}[] {
  const db = readDb()
  const users = new Map(db.users.map((u) => [u.userId, u]))
  const out: {
    resource: string
    slug: string
    payTo: string
    priceAtomic: string
    description: string
  }[] = []
  const seen = new Set<string>()
  for (const m of db.merchants) {
    const email = users.get(m.userId)?.email ?? ''
    if (email.endsWith('@xpay.test')) continue
    if (/^crowd\d*$/i.test(m.slug)) continue
    const resource = payResourcePath(m.payTo, m.slug)
    if (seen.has(resource)) continue
    seen.add(resource)
    out.push({
      resource,
      slug: m.slug,
      payTo: m.payTo,
      priceAtomic: m.priceAtomic,
      description: m.description
    })
    if (out.length >= 50) break
  }
  return out
}

export function findMerchantBySlug(slug: string): MerchantEndpoint | undefined {
  const rows = readDb().merchants.filter((m) => m.slug === slug)
  if (rows.length !== 1) return undefined
  return rows[0]
}

export function findMerchantByPayToAndSlug(payTo: string, slug: string): MerchantEndpoint | undefined {
  const addr = payTo.trim()
  return readDb().merchants.find((m) => m.payTo === addr && m.slug === slug)
}

export function upsertMerchant(row: MerchantEndpoint): MerchantEndpoint {
  return updateDb((db) => {
    const idx = db.merchants.findIndex((m) => m.id === row.id || (m.userId === row.userId && m.slug === row.slug))
    if (idx >= 0) {
      db.merchants[idx] = { ...db.merchants[idx], ...row, updatedAt: new Date().toISOString() }
      return db.merchants[idx]
    }
    db.merchants.push(row)
    return row
  })
}

export function deleteMerchant(userId: string, id: string): boolean {
  const db = readDb()
  const before = db.merchants.length
  db.merchants = db.merchants.filter((m) => !(m.userId === userId && m.id === id))
  writeDb(db)
  return db.merchants.length < before
}

export const DEFAULT_LOW_BALANCE_ATOMIC = '10000000'
export const DEFAULT_PAYOUT_THRESHOLD_ATOMIC = '100000000'

export function creditedNetAtomic(userId: string): bigint {
  let n = 0n
  for (const d of listDeposits(userId)) {
    if (d.status !== 'credited') continue
    n += BigInt(d.netAtomic ?? d.amountAtomic ?? '0')
  }
  return n
}

/**
 * Net x402 movement for a user. Rows whose on-chain settle failed must not
 * count: the seller was never paid, so crediting them would let them withdraw
 * real USDT for a payment that never happened.
 */
export function x402NetAtomic(userId: string): bigint {
  let n = 0n
  for (const p of listX402Payments(userId)) {
    if (p.archived) continue
    if (p.chainStatus === 'failed') continue
    const amount = BigInt(p.totalAtomic || p.priceAtomic || '0')
    if ((p.direction || 'received') === 'sent') n -= amount
    else n += amount
  }
  return n
}

export function reservedPayoutAtomic(userId: string): bigint {
  let n = 0n
  for (const p of listPayouts(userId)) {
    if (p.status === 'failed') continue
    n += BigInt(p.amountAtomic || '0')
  }
  return n
}

/**
 * Ledger balance from hub.json. This is a mirror of PaymentVault.balances[user];
 * use availableBalanceAtomic() for anything that moves money.
 */
export function ledgerBalanceAtomic(userId: string): bigint {
  const v = creditedNetAtomic(userId) + x402NetAtomic(userId) - reservedPayoutAtomic(userId)
  return v > 0n ? v : 0n
}

export function availableBalanceAtomic(userId: string): bigint {
  return ledgerBalanceAtomic(userId)
}

/** True when the account holds seeded demo balance that must never be paid out. */
export function isTestAccount(userId: string): boolean {
  return getUser(userId)?.testMode === true
}

/**
 * Balance capped by the vault's on-chain balance. The vault is authoritative:
 * if hub.json claims more than the vault holds (drift, failed settle, manual
 * edit), the smaller number wins so a withdrawal can never exceed the reserve.
 */
export function spendableBalanceAtomic(userId: string, vaultBalance: bigint): bigint {
  const ledger = ledgerBalanceAtomic(userId)
  return ledger < vaultBalance ? ledger : vaultBalance
}

export function listAlerts(userId: string): AlertRecord[] {
  return readDb()
    .alerts.filter((a) => a.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveAlert(row: AlertRecord): AlertRecord {
  const db = readDb()
  db.alerts.push(row)
  writeDb(db)
  return row
}

export function peekScheduledPayout(): PayoutRecord | undefined {
  return readDb().payouts.find((p) => p.status === 'scheduled')
}

export function listPayouts(userId?: string): PayoutRecord[] {
  const rows = readDb().payouts
  const filtered = userId ? rows.filter((p) => p.userId === userId) : rows
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function savePayout(row: PayoutRecord): PayoutRecord {
  const db = readDb()
  const idx = db.payouts.findIndex((p) => p.id === row.id)
  if (idx >= 0) db.payouts[idx] = row
  else db.payouts.push(row)
  writeDb(db)
  return row
}

export function listX402Payments(userId?: string): X402PaymentRecord[] {
  const rows = readDb().x402Payments
  const filtered = userId ? rows.filter((p) => p.userId === userId) : rows
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function findX402PaymentByTx(txId: string): X402PaymentRecord | undefined {
  const id = txId.trim()
  if (!id) return undefined
  return readDb().x402Payments.find((p) => p.txId === id)
}

export function saveX402Payment(row: X402PaymentRecord): X402PaymentRecord {
  const db = readDb()
  const dup = db.x402Payments.some((p) => p.userId === row.userId && p.txId === row.txId && p.direction === row.direction)
  if (dup) return row
  db.x402Payments.push(row)
  writeDb(db)
  return row
}

function netFromDb(db: DbShape, userId: string): bigint {
  let credited = 0n
  for (const d of db.deposits) {
    if (d.userId !== userId || d.status !== 'credited') continue
    credited += BigInt(d.netAtomic ?? d.amountAtomic ?? '0')
  }
  let x402 = 0n
  for (const p of db.x402Payments) {
    if (p.userId !== userId) continue
    if (p.archived) continue
    if (p.chainStatus === 'failed') continue
    const amount = BigInt(p.totalAtomic || p.priceAtomic || '0')
    if ((p.direction || 'received') === 'sent') x402 -= amount
    else x402 += amount
  }
  let reserved = 0n
  for (const p of db.payouts) {
    if (p.userId !== userId || p.status === 'failed') continue
    reserved += BigInt(p.amountAtomic || '0')
  }
  const v = credited + x402 - reserved
  return v > 0n ? v : 0n
}

function nextSignNonce(db: DbShape, fromAlph: string, vaultNonce: bigint): string {
  const pending = db.x402Queue.filter((j) => j.from === fromAlph)
  if (pending.length === 0) return vaultNonce.toString()
  const maxQueued = pending.reduce((m, j) => {
    const n = BigInt(j.nonce)
    return n > m ? n : m
  }, -1n)
  return (maxQueued + 1n).toString()
}

export function getX402Intent(
  fromAlph: string,
  vaultNonce: bigint
): { nonce: string; balanceAtomic: string; userId?: string } {
  const db = readDb()
  const user = db.users.find((u) => u.alphAddress === fromAlph)
  return {
    nonce: nextSignNonce(db, fromAlph, vaultNonce),
    balanceAtomic: user ? netFromDb(db, user.userId).toString() : '0',
    userId: user?.userId
  }
}

export function settleX402Instant(params: {
  slug: string
  payTo: string
  payer: string
  nonce: string
  vaultNonce: bigint
  deadline: string
  signature: string
  priceAtomic: string
  totalAtomic: string
  feeAtomic: string
  gasFeeAtomic: string
  platformFeeAtomic: string
  gasAlph: string
  alphUsd: string
  httpMs?: number
}): { txId: string; sellerUserId: string; payerUserId: string } {
  return updateDb((db) => {
    const merchant = db.merchants.find((m) => m.payTo === params.payTo && m.slug === params.slug)
    if (!merchant) throw new Error('merchant_not_found')
    const payerUser = db.users.find((u) => u.alphAddress === params.payer)
    if (!payerUser) throw new Error('payer_not_found')
    if (payerUser.userId === merchant.userId) throw new Error('self_pay')
    const amount = BigInt(params.totalAtomic || '0')
    if (amount <= 0n) throw new Error('invalid_amount')
    const expectedNonce = nextSignNonce(db, params.payer, params.vaultNonce)
    if (expectedNonce !== params.nonce) throw new Error('nonce_mismatch')
    if (netFromDb(db, payerUser.userId) < amount) throw new Error('insufficient_balance')

    const txId = `pending${uuidv4().replace(/-/g, '')}`
    const createdAt = new Date().toISOString()
    const shared = {
      slug: params.slug,
      txId,
      pendingTxId: txId,
      payer: params.payer,
      payTo: params.payTo,
      priceAtomic: params.priceAtomic,
      feeAtomic: params.feeAtomic,
      gasFeeAtomic: params.gasFeeAtomic,
      platformFeeAtomic: params.platformFeeAtomic,
      totalAtomic: params.totalAtomic,
      gasAlph: params.gasAlph,
      alphUsd: params.alphUsd,
      createdAt,
      httpMs: params.httpMs,
      chainStatus: 'pending' as const
    }
    db.x402Payments.push({
      id: uuidv4(),
      userId: merchant.userId,
      direction: 'received',
      ...shared
    })
    db.x402Payments.push({
      id: uuidv4(),
      userId: payerUser.userId,
      direction: 'sent',
      ...shared
    })
    db.x402Nonces[params.payer] = (BigInt(params.nonce) + 1n).toString()
    db.x402Queue.push({
      id: uuidv4(),
      pendingTxId: txId,
      from: params.payer,
      to: params.payTo,
      amount: params.totalAtomic,
      nonce: params.nonce,
      deadline: params.deadline,
      signature: params.signature,
      createdAt
    })
    return { txId, sellerUserId: merchant.userId, payerUserId: payerUser.userId }
  })
}

export function forgetX402SignNonce(fromAlph: string): void {
  updateDb((db) => {
    delete db.x402Nonces[fromAlph]
  })
}

export function peekX402ChainJob(): X402ChainJob | undefined {
  return readDb().x402Queue[0]
}

export function listX402ChainJobs(): X402ChainJob[] {
  return readDb().x402Queue
}

export function grantCreditedUsdt(userId: string, amountAtomic: string): DepositRecord {
  const amount = BigInt(amountAtomic)
  const usdt = (Number(amount) / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return saveDeposit({
    id: uuidv4(),
    userId,
    chain: 'bsc',
    token: 'USDT',
    txHash: `simcrowd${uuidv4().replace(/-/g, '')}`,
    amountAtomic: amount.toString(),
    amountUsdt: usdt,
    netAtomic: amount.toString(),
    status: 'credited',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
}

export function completeX402ChainJob(id: string): void {
  updateDb((db) => {
    db.x402Queue = db.x402Queue.filter((j) => j.id !== id)
  })
}

export function noteX402ChainJobError(id: string, error: string): number {
  return updateDb((db) => {
    const job = db.x402Queue.find((j) => j.id === id)
    if (!job) return 0
    job.attempts = (job.attempts ?? 0) + 1
    job.lastError = error
    return job.attempts
  })
}

export function saveX402SubmittedTx(jobId: string, pendingTxId: string, txId: string): void {
  const chainAt = new Date().toISOString()
  updateDb((db) => {
    const job = db.x402Queue.find((j) => j.id === jobId)
    if (job) job.submittedTxId = txId
    for (const p of db.x402Payments) {
      if (p.txId === pendingTxId || p.txId === txId) {
        p.txId = txId
        p.chainStatus = 'settled'
        delete p.chainError
        if (!p.chainAt) p.chainAt = chainAt
      }
    }
  })
}

export function patchX402TxId(pendingTxId: string, txId: string): void {
  saveX402SubmittedTx('', pendingTxId, txId)
}

export function failX402ChainReceipt(
  job: { pendingTxId: string; submittedTxId?: string; from?: string; nonce?: string },
  error: string
): void {
  updateDb((db) => {
    for (const p of db.x402Payments) {
      if (p.chainStatus === 'settled') continue
      if (p.txId === job.pendingTxId || (job.submittedTxId && p.txId === job.submittedTxId)) {
        p.chainStatus = 'failed'
        p.chainError = error
      }
    }
    if (job.from && job.nonce != null) {
      const others = db.x402Queue.filter(
        (j) => j.from === job.from && j.pendingTxId !== job.pendingTxId
      )
      if (others.length === 0) db.x402Nonces[job.from] = job.nonce
    }
  })
}

export function drainX402ChainQueue(error = 'drained'): number {
  return updateDb((db) => {
    const n = db.x402Queue.length
    for (const job of db.x402Queue) {
      for (const p of db.x402Payments) {
        if (p.chainStatus === 'settled') continue
        if (p.txId === job.pendingTxId || (job.submittedTxId && p.txId === job.submittedTxId)) {
          p.chainStatus = 'failed'
          p.chainError = error
        }
      }
    }
    db.x402Queue = []
    return n
  })
}

export function getX402ChainReceipt(txId: string): {
  txId: string
  chainStatus?: 'pending' | 'settled' | 'failed'
  chainError?: string
} | undefined {
  if (!txId) return undefined
  const row = readDb().x402Payments.find((p) => p.txId === txId || p.pendingTxId === txId)
  if (!row) return undefined
  return { txId: row.txId, chainStatus: row.chainStatus, chainError: row.chainError }
}

export function findMerchantByUserAndSlug(userId: string, slug: string): MerchantEndpoint | undefined {
  return readDb().merchants.find((m) => m.userId === userId && m.slug === slug)
}

export function listDestinations(userId: string): SavedDestination[] {
  return readDb()
    .destinations.filter((d) => d.userId === userId)
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function saveDestination(row: SavedDestination): SavedDestination {
  const db = readDb()
  const idx = db.destinations.findIndex((d) => d.id === row.id)
  if (idx >= 0) db.destinations[idx] = row
  else db.destinations.push(row)
  writeDb(db)
  return row
}

export function deleteDestination(userId: string, id: string): boolean {
  const db = readDb()
  const before = db.destinations.length
  db.destinations = db.destinations.filter((d) => !(d.userId === userId && d.id === id))
  writeDb(db)
  return db.destinations.length < before
}

/** Unique x402 pays (one txId = one transaction). Failed chain receipts are omitted. */
export function publicX402Stats(): { x402Transactions: number; x402VolumeAtomic: string } {
  const db = readDb()
  const seen = new Set<string>()
  let volume = 0n
  for (const p of db.x402Payments) {
    if (!p.txId || seen.has(p.txId)) continue
    if (p.chainStatus === 'failed') continue
    seen.add(p.txId)
    volume += BigInt(p.priceAtomic || '0')
  }
  return { x402Transactions: seen.size, x402VolumeAtomic: volume.toString() }
}
