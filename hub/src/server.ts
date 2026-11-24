import cors from 'cors'
import express from 'express'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { deriveDepositAddress, isDemoEvmAddress, isDemoSeed } from './addresses'
import {
  AuthedRequest,
  createApiKeySecret,
  loginAccount,
  loginWithOAuth,
  registerAccount,
  isPlatformAdminEmail,
  requireAdmin,
  requireAuth,
  resendVerification,
  verifyEmail
} from './auth'
import {
  beginOAuth,
  consumeOAuthState,
  exchangeGithubCode,
  exchangeGoogleCode,
  listConfiguredProviders,
  redirectToAccount
} from './oauth'
import { getToken, isSupportedChain, isTokenSymbol, publicChains } from './chains'
import { invalidateVaultNonce, readVaultNonce, verifyOnChainPayment } from './alph-x402'
import { ingestTx } from './watcher'
import { payoutsEnabled, requireAppOrigin, requireSession } from './payout-guard'
import { rateLimit } from './rate-limit'
import { startPayoutQueue } from './payout-queue'
import { startX402ChainQueue } from './x402-chain-queue'
import { creditVaultOnAlephium } from './credit'
import { isBelowMinDeposit, minDepositUsdt, quoteDepositFee, quoteTxFee, quoteWithdrawFee, quoteX402Fee } from './fees'
import { afterBalanceChange, attachFeeQuote } from './ledger'
import { platformSnapshot } from './ops'
import { startSimulatedDeposit, startSimulatedX402, pushOpsEvent } from './ops-events'
import { payPayUrl, quotePayUrl } from './x402-buyer-pay'
import { submitTicket } from './tickets'
import { startCrowdFill, startRealX402Test, startTrafficLoop, startVolumeFill } from './x402-live-test'
import { requestPayout } from './payouts'
import {
  createApiKey,
  deleteMerchant,
  findDepositByTx,
  findMerchantBySlug,
  findMerchantByPayToAndSlug,
  findX402PaymentByTx,
  findUserByAlphAddress,
  findMerchantByUserAndSlug,
  payResourcePath,
  getOrCreateDepositAddress,
  listApiKeys,
  listDeposits,
  listMerchants,
  listPublicPayResources,
  revokeApiKey,
  revokeSessions,
  saveDeposit,
  updateUser,
  upsertMerchant,
  upsertUser,
  ensureUserAlphAddress,
  availableBalanceAtomic,
  listAlerts,
  listPayouts,
  listX402Payments,
  publicX402Stats,
  saveX402Payment,
  getX402Intent,
  settleX402Instant,
  listDestinations,
  saveDestination,
  deleteDestination,
  DEFAULT_LOW_BALANCE_ATOMIC,
  DEFAULT_PAYOUT_THRESHOLD_ATOMIC
} from './store'

const app = express()
const PORT = Number(process.env.HUB_PORT ?? 43142)

/** Contract id of the Alephium USDT ledger token, resolved once per process. */
let cachedUsdtId: string | undefined
function mockUsdtContractId(): string {
  if (cachedUsdtId) return cachedUsdtId
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: { MockUSDT: { contractInstance: { contractId: string } } }
    }
  }
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  cachedUsdtId = loadDeployments(network).contracts.MockUSDT.contractInstance.contractId
  return cachedUsdtId
}

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

app.get('/health', (_req, res) => {
  res.json({ ok: true, demoSeed: isDemoSeed() })
})

app.get('/api/stats', (_req, res) => {
  res.json({
    ...publicX402Stats(),
    chains: publicChains().map((c) => c.name),
    minChargeUsdt: '0.001'
  })
})

app.get('/api/discovery/resources', (_req, res) => {
  res.json({
    x402Version: 1,
    type: 'http',
    resources: listPublicPayResources()
  })
})

app.get('/api/auth/providers', (_req, res) => {
  res.json({ providers: listConfiguredProviders() })
})

app.post('/api/tickets', async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? '')
      .split(',')[0]
      .trim()
    const result = await submitTicket({
      kind: req.body?.kind,
      email: req.body?.email,
      message: req.body?.message,
      name: req.body?.name,
      ip
    })
    res.json({ ok: true, ...result })
  } catch (e: any) {
    const code = e?.message ?? 'ticket_failed'
    const status = code === 'ticket_rate_limited' ? 429 : code === 'mail_failed' ? 503 : 400
    res.status(status).json({ error: code })
  }
})

app.get('/api/auth/google', (req, res) => beginOAuth('google', req, res))
app.get('/api/auth/github', (req, res) => beginOAuth('github', req, res))

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const code = String(req.query.code ?? '')
    const state = String(req.query.state ?? '')
    if (!code || !consumeOAuthState(state, 'google')) {
      return redirectToAccount(res, { oauth: 'invalid_state', provider: 'google' })
    }
    const profile = await exchangeGoogleCode(code)
    const { session } = loginWithOAuth({
      provider: 'google',
      providerId: profile.providerId,
      email: profile.email,
      name: profile.name
    })
    redirectToAccount(res, { token: session.token })
  } catch (e: any) {
    redirectToAccount(res, { oauth: e?.message ?? 'google_failed', provider: 'google' })
  }
})

app.get('/api/auth/github/callback', async (req, res) => {
  try {
    const code = String(req.query.code ?? '')
    const state = String(req.query.state ?? '')
    if (!code || !consumeOAuthState(state, 'github')) {
      return redirectToAccount(res, { oauth: 'invalid_state', provider: 'github' })
    }
    const profile = await exchangeGithubCode(code)
    const { session } = loginWithOAuth({
      provider: 'github',
      providerId: profile.providerId,
      email: profile.email,
      name: profile.name
    })
    redirectToAccount(res, { token: session.token })
  } catch (e: any) {
    redirectToAccount(res, { oauth: e?.message ?? 'github_failed', provider: 'github' })
  }
})

app.get('/api/chains', (_req, res) => {
  res.json({ chains: publicChains() })
})

app.post(
  '/api/auth/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'register_rate_limited' }),
  async (req, res) => {
  try {
    const result = await registerAccount(
      String(req.body.email ?? ''),
      String(req.body.password ?? ''),
      String(req.body.confirmPassword ?? '')
    )
    res.status(201).json({
      needsVerification: true,
      email: result.email,
      mailed: result.mailed
    })
  } catch (e: any) {
    const code = e?.message ?? 'register_failed'
    const status = code === 'email_taken' || code === 'email_pending_verification' ? 409 : 400
    res.status(status).json({ error: code })
  }
  }
)

/**
 * Verification codes are 6 digits, so an unthrottled endpoint is brute-forceable.
 * Limit per IP and per email: 10 attempts per 15 minutes.
 */
app.post(
  '/api/auth/verify',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    key: (req) => String(req.body?.email ?? '').trim().toLowerCase(),
    message: 'verify_rate_limited'
  }),
  async (req, res) => {
  try {
    const { user, session } = await verifyEmail({
      email: String(req.body.email ?? ''),
      code: String(req.body.code ?? ''),
      token: String(req.body.token ?? '')
    })
    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      userId: user.userId,
      email: user.email
    })
  } catch (e: any) {
    const code = e?.message ?? 'verify_failed'
    const status = code === 'already_verified' ? 409 : 400
    res.status(status).json({ error: code })
  }
  }
)

app.post('/api/auth/resend-verify', async (req, res) => {
  try {
    const result = await resendVerification(String(req.body.email ?? ''))
    res.json({ mailed: result.mailed })
  } catch (e: any) {
    const code = e?.message ?? 'resend_failed'
    const status = code === 'verify_rate_limited' ? 429 : 400
    res.status(status).json({ error: code })
  }
})

app.post(
  '/api/auth/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    key: (req) => String(req.body?.email ?? '').trim().toLowerCase(),
    message: 'login_rate_limited'
  }),
  (req, res) => {
  try {
    const { user, session } = loginAccount(String(req.body.email ?? ''), String(req.body.password ?? ''))
    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      userId: user.userId,
      email: user.email
    })
  } catch (e: any) {
    const code = e?.message ?? 'login_failed'
    res.status(code === 'email_not_verified' ? 403 : 401).json({ error: code })
  }
  }
)

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  if (req.auth?.userId) revokeSessions(req.auth.userId)
  res.json({ ok: true })
})

app.get('/api/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
  const userId = req.auth!.userId
  const user = ensureUserAlphAddress(userId)
  res.json({
    userId,
    email: user.email ?? req.auth!.email,
    name: user.name,
    alphAddress: user.alphAddress,
    via: req.auth!.via,
    apiKeys: listApiKeys(userId).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt
    })),
    merchants: listMerchants(userId).map((m) => ({ ...m, resourcePath: payResourcePath(m.payTo, m.slug) })),
    balanceAtomic: availableBalanceAtomic(userId).toString(),
    feeQuote: await quoteX402Fee(),
    minDepositUsdt: minDepositUsdt(),
    alerts: listAlerts(userId).slice(0, 30),
    payouts: listPayouts(userId).slice(0, 30),
    x402Payments: listX402Payments(userId).slice(0, 80),
    destinations: listDestinations(userId),
    deposits: listDeposits(userId)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40),
    isAdmin: isPlatformAdminEmail(user.email ?? req.auth!.email),
    payoutsEnabled: payoutsEnabled(),
    settings: {
      lowBalanceAlert: user.lowBalanceAlert !== false,
      lowBalanceThresholdAtomic: user.lowBalanceThresholdAtomic || DEFAULT_LOW_BALANCE_ATOMIC,
      payoutEnabled: Boolean(user.payoutEnabled),
      payoutThresholdAtomic: user.payoutThresholdAtomic || DEFAULT_PAYOUT_THRESHOLD_ATOMIC,
      payoutChain: user.payoutChain || 'ethereum',
      payoutAddress: user.payoutAddress || '',
      payoutToken: user.payoutToken || 'USDT'
    }
  })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'me_failed' })
  }
})

app.get('/api/admin/platform', requireAuth, requireAdmin, async (_req, res) => {
  try {
    res.json(await platformSnapshot())
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'ops_failed' })
  }
})

app.post('/api/admin/simulate', requireAuth, requireAdmin, (req, res) => {
  const kind = String(req.body?.kind ?? 'deposit')
  if (kind === 'x402') {
    const sim = startSimulatedX402()
    res.json({
      ok: true,
      kind: 'x402',
      ...sim,
      steps: ['seller_api', 'pay_url', 'http_402', 'signed', 'settling', 'recorded'],
      intervalMs: 4000
    })
    return
  }
  if (kind === 'x402-live') {
    try {
      const live = startRealX402Test()
      res.json({
        ok: true,
        kind: 'x402-live',
        ...live,
        steps: ['seller_api', 'pay_url', 'http_402', 'signed', 'settling', 'recorded']
      })
    } catch (e: any) {
      res.status(409).json({ error: e?.message ?? 'x402_live_failed' })
    }
    return
  }
  if (kind === 'x402-volume') {
    try {
      const n = Number(req.body?.count ?? 100)
      const count = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 100
      const totalUsdt = Number(req.body?.totalUsdt ?? 0)
      const totalAtomic =
        Number.isFinite(totalUsdt) && totalUsdt > 0
          ? String(BigInt(Math.round(totalUsdt * 1_000_000)))
          : undefined
      const bourmattFirst = Boolean(req.body?.bourmattFirst)
      const live = startVolumeFill(count, { totalAtomic, bourmattFirst })
      res.json({
        ok: true,
        kind: 'x402-volume',
        ...live,
        totalAtomic,
        bourmattFirst,
        steps: bourmattFirst ? ['bourmatt_to_admin', 'admin_to_bourmatt'] : ['admin_to_bourmatt', 'bourmatt_to_admin']
      })
    } catch (e: any) {
      res.status(409).json({ error: e?.message ?? 'x402_volume_failed' })
    }
    return
  }
  if (kind === 'x402-crowd') {
    try {
      const customers = Number(req.body?.customers ?? 8)
      const paysEach = Number(req.body?.paysEach ?? 5)
      const live = startCrowdFill({
        customers: Number.isFinite(customers) ? customers : 8,
        paysEach: Number.isFinite(paysEach) ? paysEach : 5
      })
      res.json({
        ok: true,
        kind: 'x402-crowd',
        ...live,
        steps: ['create_accounts', 'fund_vault', 'parallel_pays']
      })
    } catch (e: any) {
      res.status(409).json({ error: e?.message ?? 'x402_crowd_failed' })
    }
    return
  }
  const sim = startSimulatedDeposit()
  res.json({
    ok: true,
    kind: 'deposit',
    ...sim,
    steps: ['detected', 'confirmed', 'sweeping', 'credited'],
    intervalMs: 5000
  })
})

app.get('/api/fees/quote', async (req, res) => {
  try {
    const chain = String(req.query.chain ?? '')
    const kind = String(req.query.kind ?? '')
    if (kind === 'withdraw' && chain) {
      const amountAtomic = String(req.query.amountAtomic ?? '')
      res.json(await quoteWithdrawFee(chain, amountAtomic || undefined))
      return
    }
    if (kind === 'x402') {
      res.json(await quoteX402Fee())
      return
    }
    if (chain) {
      res.json(await quoteDepositFee(chain))
      return
    }
    res.json(await quoteX402Fee())
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'quote_failed' })
  }
})

app.post('/api/me/settings', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const userId = req.auth!.userId
  const thresholdFromUsdt = (value: unknown, fallback: string) => {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) return String(BigInt(Math.round(n * 1_000_000)))
    return fallback
  }
  const payoutChain = String(req.body.payoutChain ?? '')
  const payoutToken = String(req.body.payoutToken ?? 'USDT').toUpperCase()
  const user = updateUser(userId, {
    lowBalanceAlert: req.body.lowBalanceAlert !== false,
    lowBalanceThresholdAtomic: thresholdFromUsdt(req.body.lowBalanceThresholdUsdt, DEFAULT_LOW_BALANCE_ATOMIC),
    payoutEnabled: payoutsEnabled() && Boolean(req.body.payoutEnabled),
    payoutThresholdAtomic: thresholdFromUsdt(req.body.payoutThresholdUsdt, DEFAULT_PAYOUT_THRESHOLD_ATOMIC),
    payoutChain: isSupportedChain(payoutChain) ? payoutChain : undefined,
    payoutAddress: String(req.body.payoutAddress ?? '').trim(),
    payoutToken: isTokenSymbol(payoutToken) ? payoutToken : 'USDT'
  })
  if (!user) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

app.get('/api/x402/pay-url', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const url = String(req.query.url ?? '')
    res.json(await quotePayUrl(req.auth!.userId, url))
  } catch (e: any) {
    const code = e?.message ?? 'quote_failed'
    const status =
      code === 'merchant_not_found'
        ? 404
        : code === 'self_pay' ||
            code === 'invalid_pay_url' ||
            code === 'pay_url_required' ||
            code === 'invalid_402' ||
            code === 'expected_402'
          ? 400
          : 400
    res.status(status).json({ error: code })
  }
})

app.post('/api/x402/pay-url', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const url = String(req.body?.url ?? req.query.url ?? '')
    res.json(await payPayUrl(req.auth!.userId, url))
  } catch (e: any) {
    const code = e?.message ?? 'pay_failed'
    const status =
      code === 'merchant_not_found'
        ? 404
        : code === 'self_pay' ||
            code === 'insufficient_balance' ||
            code === 'invalid_pay_url' ||
            code === 'pay_url_required' ||
            code === 'nonce_mismatch' ||
            code === 'bad_signature'
          ? 400
          : 400
    res.status(status).json({ error: code })
  }
})

app.get('/api/x402/intent', async (req, res) => {
  const from = String(req.query.from ?? '').trim()
  if (!from) return res.status(400).json({ error: 'from_required' })
  try {
    const vaultNonce = await readVaultNonce(from)
    res.json(getX402Intent(from, vaultNonce))
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'intent_failed' })
  }
})

app.post('/api/x402/settle', async (req, res) => {
  try {
    const quote = await quoteX402Fee()
    const priceAtomic = String(req.body.priceAtomic ?? '')
    const quotedTotal = String(req.body.totalAtomic ?? '')
    const expectedTotal = quotedTotal || String(BigInt(priceAtomic || '0') + BigInt(quote.totalUsdtAtomic))
    const payTo = String(req.body.payTo ?? '').trim()
    const payer = String(req.body.payer ?? '').trim()
    const nonce = String(req.body.nonce ?? '')
    const signature = String(req.body.signature ?? '').trim()
    const deadline = String(req.body.deadline ?? '')
    if (!signature || !deadline) return res.status(400).json({ error: 'signature_required' })
    const vaultNonce = await readVaultNonce(payer)
    const httpMsRaw = Number(req.body.httpMs)
    const result = settleX402Instant({
      slug: String(req.body.slug ?? ''),
      payTo,
      payer,
      nonce,
      vaultNonce,
      deadline,
      signature,
      priceAtomic,
      totalAtomic: expectedTotal,
      feeAtomic: quote.totalUsdtAtomic,
      gasFeeAtomic: quote.gasUsdtAtomic,
      platformFeeAtomic: quote.platformUsdtAtomic,
      gasAlph: quote.gasAlph,
      alphUsd: quote.alphUsd,
      httpMs: Number.isFinite(httpMsRaw) && httpMsRaw >= 0 ? Math.round(httpMsRaw) : undefined
    })
    pushOpsEvent({
      kind: 'x402',
      status: 'settled',
      title: 'X402 payment',
      detail: `${req.body.slug ?? ''} · ${expectedTotal} atomic`,
      txId: result.txId
    })
    invalidateVaultNonce(payer)
    void afterBalanceChange(result.sellerUserId)
    void afterBalanceChange(result.payerUserId)
    res.json({ ok: true, txId: result.txId })
  } catch (e: any) {
    const code = e?.message ?? 'settle_failed'
    const status =
      code === 'merchant_not_found' || code === 'payer_not_found'
        ? 404
        : code === 'nonce_mismatch' ||
            code === 'insufficient_balance' ||
            code === 'insufficient_vault_balance' ||
            code === 'self_pay' ||
            code === 'invalid_amount' ||
            code === 'invalid_txid' ||
            code === 'duplicate_txid' ||
            code === 'signature_required'
          ? 400
          : 500
    res.status(status).json({ error: code })
  }
})

/**
 * Records an already-settled x402 payment. Requires an authenticated caller and a
 * txId that exists on the Alephium node, so fabricated receipts cannot mint balance.
 */
app.post('/api/x402/record', requireAuth, requireSession, requireAppOrigin, async (req: AuthedRequest, res) => {
  try {
    const slug = String(req.body.slug ?? '')
    const payTo = String(req.body.payTo ?? '').trim()
    const payer = String(req.body.payer ?? '').trim()
    const merchant = payTo
      ? findMerchantByPayToAndSlug(payTo, slug)
      : findMerchantBySlug(slug)
    if (!merchant) return res.status(404).json({ error: 'merchant_not_found' })

    const isAdmin = isPlatformAdminEmail(req.auth!.email)
    const ownsMerchant = merchant.userId === req.auth!.userId
    if (!isAdmin && !ownsMerchant) return res.status(403).json({ error: 'forbidden' })

    const txId = String(req.body.txId ?? '').trim()
    if (!txId) return res.status(400).json({ error: 'txid_required' })
    if (findX402PaymentByTx(txId)) return res.status(409).json({ error: 'duplicate_txid' })

    const priceAtomic = String(req.body.priceAtomic ?? merchant.priceAtomic)
    if (!/^\d+$/.test(priceAtomic) || BigInt(priceAtomic) <= 0n) {
      return res.status(400).json({ error: 'invalid_price' })
    }
    const onChain = await verifyOnChainPayment({
      txId,
      payTo: merchant.payTo,
      tokenId: mockUsdtContractId(),
      minAmount: BigInt(priceAtomic)
    })
    if (!onChain.ok) return res.status(400).json({ error: onChain.reason ?? 'tx_not_found' })

    const quote = await quoteTxFee()
    const totalAtomic = String(req.body.totalAtomic ?? '')
    const createdAt = new Date().toISOString()
    const shared = {
      slug,
      txId,
      payer: payer || undefined,
      payTo: merchant.payTo,
      priceAtomic,
      feeAtomic: quote.totalUsdtAtomic,
      gasFeeAtomic: quote.gasUsdtAtomic,
      platformFeeAtomic: quote.platformUsdtAtomic,
      totalAtomic: totalAtomic || String(BigInt(priceAtomic) + BigInt(quote.totalUsdtAtomic)),
      gasAlph: quote.gasAlph,
      alphUsd: quote.alphUsd,
      createdAt
    }
    saveX402Payment({
      id: uuidv4(),
      userId: merchant.userId,
      direction: 'received',
      ...shared
    })
    pushOpsEvent({
      kind: 'x402',
      status: 'settled',
      title: 'X402 payment',
      detail: `${slug} · ${shared.totalAtomic} atomic`,
      txId
    })
    const payerUser = payer ? findUserByAlphAddress(payer) : undefined
    if (payerUser && payerUser.userId !== merchant.userId) {
      saveX402Payment({
        id: uuidv4(),
        userId: payerUser.userId,
        direction: 'sent',
        ...shared
      })
    }
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'record_failed' })
  }
})

app.post('/api/me/alph-address', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const alphAddress = String(req.body.alphAddress ?? '').trim()
  if (!alphAddress) return res.status(400).json({ error: 'alph_address_required' })
  const user = updateUser(req.auth!.userId, { alphAddress })
  if (!user) return res.status(404).json({ error: 'not_found' })
  res.json({ userId: user.userId, email: user.email, alphAddress: user.alphAddress })
})

/** Admin-only: creates a bare user row. No client calls this; kept for ops tooling. */
app.post('/api/users', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const userId = String(req.body.userId ?? uuidv4())
  const alphAddress = req.body.alphAddress ? String(req.body.alphAddress) : undefined
  const user = upsertUser(userId, alphAddress)
  res.json(user)
})

app.post('/api/deposits/address', requireAuth, (req: AuthedRequest, res) => {
  try {
    const userId = req.auth!.userId
    const chain = String(req.body.chain ?? '')
    const tokenSymbol = String(req.body.token ?? 'USDT').toUpperCase()
    if (!isSupportedChain(chain)) return res.status(400).json({ error: 'unsupported_chain' })
    if (!isTokenSymbol(tokenSymbol)) return res.status(400).json({ error: 'unsupported_token' })

    ensureUserAlphAddress(userId)
    const row = getOrCreateDepositAddress(userId, chain, (index) => deriveDepositAddress(chain, index))
    const token = getToken(chain, tokenSymbol)
    res.json({
      ...row,
      token: token.address,
      tokenSymbol: token.symbol,
      decimals: token.decimals,
      warning:
        isDemoSeed() || isDemoEvmAddress(row.address, row.derivationIndex)
          ? 'Demo HD seed in use. Set HUB_MNEMONIC before accepting real funds.'
          : undefined
    })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) })
  }
})

app.get('/api/deposits', requireAuth, (req: AuthedRequest, res) => {
  res.json({ deposits: listDeposits(req.auth!.userId) })
})

app.get('/api/destinations', requireAuth, (req: AuthedRequest, res) => {
  res.json({ destinations: listDestinations(req.auth!.userId) })
})

app.post('/api/destinations', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const label = String(req.body.label ?? '').trim()
  const chain = String(req.body.chain ?? '')
  const token = String(req.body.token ?? 'USDT').toUpperCase()
  const address = String(req.body.address ?? '').trim()
  if (!label) return res.status(400).json({ error: 'label_required' })
  if (!isSupportedChain(chain)) return res.status(400).json({ error: 'unsupported_chain' })
  if (!isTokenSymbol(token)) return res.status(400).json({ error: 'unsupported_token' })
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: 'invalid_address' })
  const now = new Date().toISOString()
  const existingId = String(req.body.id ?? '').trim()
  const row = saveDestination({
    id: existingId || uuidv4(),
    userId: req.auth!.userId,
    label,
    chain,
    token,
    address,
    createdAt: existingId
      ? listDestinations(req.auth!.userId).find((d) => d.id === existingId)?.createdAt ?? now
      : now
  })
  res.status(existingId ? 200 : 201).json(row)
})

app.delete('/api/destinations/:id', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const ok = deleteDestination(req.auth!.userId, String(req.params.id))
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

app.post(
  '/api/payouts',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'payout_rate_limited' }),
  requireAuth,
  requireSession,
  requireAppOrigin,
  async (req: AuthedRequest, res) => {
  try {
    const amountUsdt = Number(req.body.amountUsdt ?? req.body.amount)
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      return res.status(400).json({ error: 'invalid_amount' })
    }
    const amountAtomic = String(BigInt(Math.round(amountUsdt * 1_000_000)))
    const row = await requestPayout({
      userId: req.auth!.userId,
      chain: String(req.body.chain ?? ''),
      token: String(req.body.token ?? 'USDT').toUpperCase(),
      toAddress: String(req.body.toAddress ?? ''),
      amountAtomic
    })
    res.json(row)
  } catch (e: any) {
    const msg = e?.message ?? 'payout_failed'
    const known = [
      'unsupported_chain',
      'unsupported_token',
      'invalid_address',
      'invalid_amount',
      'insufficient_balance',
      'amount_too_small_for_fees',
      'below_min_withdraw',
      'withdraw_usdt_only',
      'treasury_usdt_short',
      'destination_not_saved',
      'destination_cooling_down',
      'payout_rate_limited'
    ]
    if (msg === 'payouts_locked' || msg === 'session_required' || msg === 'forbidden_origin') {
      return res.status(403).json({ error: msg })
    }
    res.status(known.includes(msg) ? 400 : 500).json({ error: msg })
  }
  }
)

/** Manual confirm for demos / ops when watcher is off */
/**
 * Re-ingests a deposit from its on-chain receipt. The amount is read from the
 * ERC-20 Transfer log, never from the request body, so a caller cannot mint balance.
 */
app.post('/api/deposits/confirm', requireAuth, requireSession, requireAdmin, requireAppOrigin, async (req: AuthedRequest, res) => {
  try {
    const chain = String(req.body.chain ?? '')
    const txHash = String(req.body.txHash ?? '').trim()
    if (!isSupportedChain(chain) || !txHash) {
      return res.status(400).json({ error: 'invalid_body' })
    }
    if (!/^0x[0-9a-f]{64}$/i.test(txHash)) {
      return res.status(400).json({ error: 'invalid_txhash' })
    }
    if (findDepositByTx(chain, txHash)) {
      return res.status(409).json({ error: 'already_exists' })
    }

    await ingestTx(chain, txHash)
    const deposit = findDepositByTx(chain, txHash)
    if (!deposit) {
      return res.status(400).json({ error: 'no_matching_transfer' })
    }
    res.json(deposit)
  } catch (e: any) {
    const code = e?.message ?? String(e)
    const status = code === 'tx_not_found' ? 400 : 500
    res.status(status).json({ error: code })
  }
})

app.post('/api/deposits/:id/credit', requireAuth, requireSession, requireAdmin, requireAppOrigin, async (req: AuthedRequest, res) => {
  const deposits = listDeposits(req.auth!.userId)
  const deposit = deposits.find((d) => d.id === req.params.id)
  if (!deposit) return res.status(404).json({ error: 'not_found' })
  const updated = await creditVaultOnAlephium(deposit)
  res.json(updated)
})

app.get('/api/keys', requireAuth, (req: AuthedRequest, res) => {
  res.json({
    keys: listApiKeys(req.auth!.userId).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt
    }))
  })
})

app.post('/api/keys', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const name = String(req.body.name ?? 'default').slice(0, 64)
  const { secret, prefix, hash } = createApiKeySecret()
  const row = createApiKey({
    id: uuidv4(),
    userId: req.auth!.userId,
    name,
    keyPrefix: prefix,
    keyHash: hash,
    createdAt: new Date().toISOString()
  })
  res.status(201).json({
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt,
    secret
  })
})

app.delete('/api/keys/:id', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const revoked = revokeApiKey(req.auth!.userId, String(req.params.id))
  if (!revoked) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

app.get('/api/merchants', requireAuth, (req: AuthedRequest, res) => {
  res.json({
    merchants: listMerchants(req.auth!.userId).map((m) => ({ ...m, resourcePath: payResourcePath(m.payTo, m.slug) }))
  })
})

app.post('/api/merchants', requireAuth, requireSession, requireAppOrigin, (req: AuthedRequest, res) => {
  const userId = req.auth!.userId
  const slugRaw = String(req.body.slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const slug = slugRaw.slice(0, 48)
  if (!slug || slug.length < 3) return res.status(400).json({ error: 'invalid_slug' })

  const existing = findMerchantByUserAndSlug(userId, slug)

  const priceAtomic = String(req.body.priceAtomic ?? '1000000')
  if (!/^\d+$/.test(priceAtomic) || BigInt(priceAtomic) <= 0n) {
    return res.status(400).json({ error: 'invalid_price' })
  }

  const user = ensureUserAlphAddress(userId)
  const payTo = user.alphAddress ?? ''
  if (!payTo) return res.status(500).json({ error: 'receive_account_missing' })
  const description = String(req.body.description ?? 'USDT micropayment via XPay x402').slice(0, 200)
  const now = new Date().toISOString()
  const merchant = upsertMerchant({
    id: existing?.id ?? uuidv4(),
    userId,
    slug,
    payTo,
    priceAtomic,
    description,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })

  res.status(existing ? 200 : 201).json({
    ...merchant,
    resourcePath: payResourcePath(merchant.payTo, merchant.slug)
  })
})

app.delete('/api/merchants/:id', requireAuth, (req: AuthedRequest, res) => {
  const ok = deleteMerchant(req.auth!.userId, String(req.params.id))
  if (!ok) return res.status(404).json({ error: 'not_found' })
  res.json({ ok: true })
})

/** Public: used by Next paid routes to resolve merchant payTo/price */
function merchantPublic(merchant: { slug: string; payTo: string; priceAtomic: string; description: string }) {
  return {
    slug: merchant.slug,
    payTo: merchant.payTo,
    priceAtomic: merchant.priceAtomic,
    description: merchant.description,
    resourcePath: payResourcePath(merchant.payTo, merchant.slug)
  }
}

app.get('/api/merchants/by-slug/:slug', (req, res) => {
  const merchant = findMerchantBySlug(String(req.params.slug))
  if (!merchant) return res.status(404).json({ error: 'not_found' })
  res.json(merchantPublic(merchant))
})

app.get('/api/merchants/by-payto/:payTo/slug/:slug', (req, res) => {
  const merchant = findMerchantByPayToAndSlug(String(req.params.payTo), String(req.params.slug))
  if (!merchant) return res.status(404).json({ error: 'not_found' })
  res.json(merchantPublic(merchant))
})

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'))
})

app.get('/', (_req, res) => {
  res.redirect('/dashboard')
})

const httpServer = app.listen(PORT, '127.0.0.1', () => {
  startX402ChainQueue()
  startPayoutQueue()
  startTrafficLoop()
  console.log(`Deposit Hub listening on http://127.0.0.1:${PORT}/dashboard`)
  if (!payoutsEnabled()) console.warn('PAYOUTS LOCKED (set HUB_PAYOUTS_ENABLED=1 to unlock)')
  if (isDemoSeed()) {
    console.warn('WARNING: using demo mnemonic. Do not send real USDT.')
  }
})
httpServer.setTimeout(120_000)
