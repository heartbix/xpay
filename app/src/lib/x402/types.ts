export const ALEPHIUM_X402_NETWORK = {
  devnet: 'alephium:devnet',
  testnet: 'alephium:testnet',
  mainnet: 'alephium:mainnet'
} as const

export type AlephiumX402Network = (typeof ALEPHIUM_X402_NETWORK)[keyof typeof ALEPHIUM_X402_NETWORK]

export type ExactPaymentRequirements = {
  scheme: 'exact'
  network: AlephiumX402Network
  maxAmountRequired: string
  resource: string
  description: string
  mimeType: string
  payTo: string
  asset: string
  maxTimeoutSeconds: number
  extra: {
    vaultId: string
    vaultAddress: string
    priceAtomic?: string
    fee?: {
      gasAlph: string
      alphUsd: string
      gasUsdtAtomic: string
      platformUsdtAtomic: string
      totalUsdtAtomic: string
    }
    agent?: {
      product: string
      use: string
      docs: string
      next: string
    }
  }
}

export type ExactPaymentPayload = {
  scheme: 'exact'
  network: AlephiumX402Network
  payload: {
    from: string
    to: string
    amount: string
    nonce: string
    deadline: string
    signature: string
  }
}

export type VerifyResult = {
  isValid: boolean
  invalidReason?: string
  payer?: string
}

export type SettleResult = {
  success: boolean
  txId?: string
  errorReason?: string
}
