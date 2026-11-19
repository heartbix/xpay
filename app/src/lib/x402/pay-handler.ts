import { NextRequest, NextResponse } from 'next/server'
import { settleExactPayment, verifyExactPayment } from '@/lib/x402/facilitator'
import { ExactPaymentPayload, ExactPaymentRequirements } from '@/lib/x402/types'
import { hubFetch } from '@/lib/hub'
import { railConfig } from '@/services/utils'

type MerchantPublic = {
  slug: string
  payTo: string
  priceAtomic: string
  description: string
  resourcePath?: string
}

type FeeQuote = {
  gasAlph: string
  alphUsd: string
  gasUsdtAtomic: string
  platformUsdtAtomic: string
  totalUsdtAtomic: string
}

function usdtToAtomic(value: string): string | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  return String(BigInt(Math.round(n * 1_000_000)))
}

async function resolvePrice(req: NextRequest, slug: string, fallbackAtomic: string): Promise<string> {
  const quoted = req.nextUrl.searchParams.get('price')
  if (!quoted) return fallbackAtomic
  const atomic = usdtToAtomic(quoted)
  if (!atomic) return fallbackAtomic
  const apiKey = req.headers.get('x-api-key')?.trim()
  if (!apiKey) {
    throw Object.assign(new Error('api_key_required_for_custom_price'), { status: 401 })
  }
  const data = await hubFetch<{ merchants: { slug: string }[] }>('/api/merchants', { apiKey })
  const owned = data.merchants?.some((m) => m.slug === slug)
  if (!owned) {
    throw Object.assign(new Error('forbidden_slug'), { status: 403 })
  }
  return atomic
}

async function buildRequirements(merchant: MerchantPublic, resource: string): Promise<ExactPaymentRequirements> {
  let fee: FeeQuote | undefined
  try {
    fee = await hubFetch<FeeQuote>('/api/fees/quote?kind=x402')
  } catch {
    fee = undefined
  }
  const total = fee
    ? String(BigInt(merchant.priceAtomic) + BigInt(fee.totalUsdtAtomic))
    : merchant.priceAtomic
  return {
    scheme: 'exact',
    network: `alephium:${railConfig.network}`,
    maxAmountRequired: total,
    resource,
    description: merchant.description,
    mimeType: 'application/json',
    payTo: merchant.payTo,
    asset: railConfig.mockUsdtTokenId,
    maxTimeoutSeconds: 7200,
    extra: {
      vaultId: `alephium:${railConfig.network}`,
      vaultAddress: railConfig.paymentVaultAddress,
      priceAtomic: merchant.priceAtomic,
      fee,
      agent: {
        product: 'XPay',
        use: 'USDT HTTP 402 micropayments',
        docs: 'https://xpay.heartbix.com/llms.txt',
        next: 'POST /api/hub/x402/pay-url with x-api-key and { url }. Or npm i @heartbix/xpay / pip install xpay-client / npx @heartbix/xpay-mcp. Signing PAYMENT-SIGNATURE is optional.'
      }
    }
  }
}

export async function handlePay(req: NextRequest, slug: string, payTo?: string) {
  let merchant: MerchantPublic
  try {
    merchant = payTo
      ? await hubFetch<MerchantPublic>(
          `/api/merchants/by-payto/${encodeURIComponent(payTo)}/slug/${encodeURIComponent(slug)}`
        )
      : await hubFetch<MerchantPublic>(`/api/merchants/by-slug/${encodeURIComponent(slug)}`)
  } catch {
    return NextResponse.json({ error: 'merchant_not_found' }, { status: 404 })
  }

  try {
    merchant = { ...merchant, priceAtomic: await resolvePrice(req, slug, merchant.priceAtomic) }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'price_forbidden' }, { status: e?.status ?? 400 })
  }

  const resource = merchant.resourcePath || (payTo ? `/api/pay/${payTo}/${slug}` : `/api/pay/${slug}`)
  const requirements = await buildRequirements(merchant, resource)
  const paymentHeader = req.headers.get('PAYMENT-SIGNATURE') ?? req.headers.get('x-payment')

  if (!paymentHeader) {
    return NextResponse.json(
      {
        error: 'Payment Required',
        accepts: [requirements]
      },
      {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(requirements)).toString('base64')
        }
      }
    )
  }

  let payment: ExactPaymentPayload
  try {
    payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'invalid_payment_header' }, { status: 400 })
  }

  const payStarted = Date.now()
  const verified = await verifyExactPayment(requirements, payment)
  if (!verified.isValid) {
    return NextResponse.json({ error: verified.invalidReason }, { status: 402 })
  }

  const settled = await settleExactPayment(payment, {
    slug,
    priceAtomic: merchant.priceAtomic,
    totalAtomic: requirements.maxAmountRequired,
    httpMs: Date.now() - payStarted
  })
  if (!settled.success) {
    return NextResponse.json({ error: settled.errorReason }, { status: 402 })
  }

  return NextResponse.json(
    {
      ok: true,
      slug,
      payTo: merchant.payTo,
      payer: verified.payer,
      txId: settled.txId,
      fee: requirements.extra.fee,
      totalAtomic: requirements.maxAmountRequired,
      message: `Payment received for ${slug}`
    },
    {
      headers: {
        'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, txId: settled.txId })).toString('base64')
      }
    }
  )
}
