import { NextRequest, NextResponse } from 'next/server'
import { ExactPaymentPayload, ExactPaymentRequirements } from '@/lib/x402/types'
import { settleExactPayment, verifyExactPayment } from '@/lib/x402/facilitator'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const body = await req.json()
  const requirements = body.paymentRequirements as ExactPaymentRequirements
  const payment = body.paymentPayload as ExactPaymentPayload

  const verified = await verifyExactPayment(requirements, payment)
  if (!verified.isValid) {
    return NextResponse.json(verified, { status: 400 })
  }

  const settled = await settleExactPayment(payment, {
    slug: typeof body.slug === 'string' ? body.slug : undefined,
    priceAtomic: requirements.maxAmountRequired,
    totalAtomic: requirements.maxAmountRequired
  })
  return NextResponse.json(settled, { status: settled.success ? 200 : 500 })
}
