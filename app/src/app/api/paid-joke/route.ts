import { NextRequest, NextResponse } from 'next/server'
import { settleExactPayment, verifyExactPayment } from '@/lib/x402/facilitator'
import { buildPaidJokeRequirements } from '@/lib/x402/requirements'
import { ExactPaymentPayload } from '@/lib/x402/types'

const JOKES = [
  'Why did the UTXO cross the shard? To get to the other group.',
  'Ralph told Solidity: nice try, but we approve assets in braces.',
  'An agent walks into an API and gets a 402. It pays in AlphUSD and walks out laughing.'
]

export async function GET(req: NextRequest) {
  const paymentHeader = req.headers.get('PAYMENT-SIGNATURE') ?? req.headers.get('x-payment')
  const requirements = buildPaidJokeRequirements('/api/paid-joke')

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

  const verified = await verifyExactPayment(requirements, payment)
  if (!verified.isValid) {
    return NextResponse.json({ error: verified.invalidReason }, { status: 402 })
  }

  const settled = await settleExactPayment(payment)
  if (!settled.success) {
    return NextResponse.json({ error: settled.errorReason }, { status: 502 })
  }

  const joke = JOKES[Math.floor(Math.random() * JOKES.length)]
  return NextResponse.json(
    { joke, payer: verified.payer, txId: settled.txId },
    {
      headers: {
        'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, txId: settled.txId })).toString('base64')
      }
    }
  )
}
