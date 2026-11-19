import { NextResponse } from 'next/server'
import { railConfig } from '@/services/utils'

export async function GET() {
  return NextResponse.json({
    kinds: [
      {
        x402Version: 2,
        scheme: 'exact',
        network: `alephium:${railConfig.network}`,
        asset: railConfig.mockUsdtTokenId,
        vault: railConfig.paymentVaultAddress
      }
    ]
  })
}
