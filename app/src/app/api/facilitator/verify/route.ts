import { NextRequest, NextResponse } from 'next/server'
import { ExactPaymentPayload, ExactPaymentRequirements } from '@/lib/x402/types'
import { verifyExactPayment } from '@/lib/x402/facilitator'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const requirements = body.paymentRequirements as ExactPaymentRequirements
  const payment = body.paymentPayload as ExactPaymentPayload
  const result = await verifyExactPayment(requirements, payment)
  return NextResponse.json(result, { status: result.isValid ? 200 : 400 })
}
