import { ExactPaymentRequirements } from './types'
import { railConfig } from '@/services/utils'

export function getMerchantPayTo(): string {
  return process.env.NEXT_PUBLIC_X402_PAY_TO ?? process.env.X402_PAY_TO ?? railConfig.gasSponsorAddress
}

export function buildPaidJokeRequirements(resource: string): ExactPaymentRequirements {
  const price = process.env.NEXT_PUBLIC_X402_JOKE_PRICE ?? process.env.X402_JOKE_PRICE ?? '1000000'
  return {
    scheme: 'exact',
    network: `alephium:${railConfig.network}`,
    maxAmountRequired: price,
    resource,
    description: 'Paid joke on Alephium USDT rail',
    mimeType: 'application/json',
    payTo: getMerchantPayTo(),
    asset: railConfig.mockUsdtTokenId,
    maxTimeoutSeconds: 600,
    extra: {
      vaultId: `alephium:${railConfig.network}`,
      vaultAddress: railConfig.paymentVaultAddress
    }
  }
}
