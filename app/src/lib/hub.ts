const HUB_URL = process.env.HUB_URL ?? process.env.NEXT_PUBLIC_HUB_URL ?? 'http://127.0.0.1:43142'

export function getHubBaseUrl(): string {
  return HUB_URL.replace(/\/dashboard\/?$/, '').replace(/\/$/, '')
}

export async function hubFetch<T>(
  path: string,
  init: RequestInit & { token?: string; apiKey?: string } = {}
): Promise<T> {
  const { token, apiKey, headers, ...rest } = init
  const nextHeaders = new Headers(headers)
  if (!nextHeaders.has('Content-Type') && rest.body) {
    nextHeaders.set('Content-Type', 'application/json')
  }
  if (token) nextHeaders.set('Authorization', `Bearer ${token}`)
  if (apiKey) nextHeaders.set('x-api-key', apiKey)

  const res = await fetch(`${getHubBaseUrl()}${path}`, {
    ...rest,
    headers: nextHeaders,
    cache: 'no-store'
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as any)?.error ?? `hub_${res.status}`)
  }
  return data as T
}

export type HubToken = {
  symbol: string
  address: string
  decimals: number
}

export type HubChain = {
  id: string
  name: string
  chainId: number
  usdt: string
  decimals: number
  tokens?: HubToken[]
}

export type HubMerchant = {
  id: string
  userId: string
  slug: string
  payTo: string
  priceAtomic: string
  description: string
  createdAt: string
  updatedAt: string
  resourcePath?: string
}

export type HubApiKey = {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt?: string
  secret?: string
}

export type HubDeposit = {
  id: string
  userId: string
  chain: string
  token?: string
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
  status: string
  creditTxId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type HubFeeQuote = {
  gasAlph: string
  alphUsd: string
  gasUsdtAtomic: string
  platformUsdtAtomic: string
  sweepUsdtAtomic?: string
  hopUsdtAtomic?: string
  totalUsdtAtomic: string
  quotedAt: string
  chain?: string
}

export type HubAlert = {
  id: string
  kind: string
  message: string
  emailed: boolean
  createdAt: string
}

export type HubPayout = {
  id: string
  chain: string
  token: string
  toAddress: string
  amountAtomic: string
  feeAtomic: string
  netAtomic: string
  status: string
  txHash?: string
  error?: string
  createdAt: string
}

export type HubDestination = {
  id: string
  label: string
  chain: string
  token: string
  address: string
  createdAt: string
}

export type HubX402Payment = {
  id: string
  slug: string
  txId: string
  direction?: 'sent' | 'received'
  payer?: string
  payTo?: string
  priceAtomic: string
  feeAtomic: string
  totalAtomic: string
  gasAlph?: string
  alphUsd?: string
  createdAt: string
  httpMs?: number
  chainAt?: string
  chainStatus?: 'pending' | 'settled' | 'failed'
}

export type HubSettings = {
  lowBalanceAlert: boolean
  lowBalanceThresholdAtomic: string
  payoutEnabled: boolean
  payoutThresholdAtomic: string
  payoutChain: string
  payoutAddress: string
  payoutToken: string
}

export type DepositAddressResponse = {
  address: string
  chain: string
  token: string
  tokenSymbol: string
  decimals: number
  warning?: string
}
