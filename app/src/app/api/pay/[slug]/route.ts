import { NextRequest } from 'next/server'
import { handlePay } from '@/lib/x402/pay-handler'

export const maxDuration = 120

export async function GET(req: NextRequest, ctx: { params: { slug: string } }) {
  return handlePay(req, ctx.params.slug)
}

export async function POST(req: NextRequest, ctx: { params: { slug: string } }) {
  return handlePay(req, ctx.params.slug)
}
