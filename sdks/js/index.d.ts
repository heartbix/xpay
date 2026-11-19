export type XpayClientOptions = {
  apiKey?: string
  hub?: string
}

export type XpayClient = {
  hub: string
  quote(url: string): Promise<Record<string, unknown>>
  pay(url: string): Promise<Record<string, unknown>>
  me(): Promise<Record<string, unknown>>
  createEndpoint(opts?: {
    slug?: string
    priceAtomic?: string
    priceUsdt?: number | string
    description?: string
  }): Promise<Record<string, unknown>>
  fetch(url: string | URL, init?: RequestInit): Promise<Response>
}

export function createClient(opts?: XpayClientOptions): XpayClient
export function xpayFetch(url: string | URL, init?: RequestInit): Promise<Response>
export function quote(url: string): Promise<Record<string, unknown>>
export function pay(url: string): Promise<Record<string, unknown>>
declare const _default: XpayClient
export default _default
