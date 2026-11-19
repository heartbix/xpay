import { SupportedChain } from './chains'

type PriceCache = { usd: number; at: number }

let cache: PriceCache | null = null
const TTL_MS = 60_000
const nativeCache = new Map<string, PriceCache>()

const NATIVE_COINGECKO: Record<SupportedChain, string> = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  polygon: 'polygon-ecosystem-token',
  arbitrum: 'ethereum',
  base: 'ethereum'
}

export async function getAlphUsdPrice(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.usd
  const fallback = Number(process.env.ALPH_USD ?? '0.15')
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=alephium&vs_currencies=usd',
      { cache: 'no-store' }
    )
    const json = (await res.json()) as { alephium?: { usd?: number } }
    const usd = Number(json?.alephium?.usd)
    if (Number.isFinite(usd) && usd > 0) {
      cache = { usd, at: Date.now() }
      return usd
    }
  } catch {
    /* use fallback */
  }
  cache = { usd: fallback, at: Date.now() }
  return fallback
}

export async function getNativeUsdPrice(chain: SupportedChain): Promise<number> {
  const id = NATIVE_COINGECKO[chain]
  const hit = nativeCache.get(id)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.usd
  const fallback = chain === 'bsc' ? 600 : chain === 'polygon' ? 0.15 : 3000
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      { cache: 'no-store' }
    )
    const json = (await res.json()) as Record<string, { usd?: number }>
    const usd = Number(json?.[id]?.usd)
    if (Number.isFinite(usd) && usd > 0) {
      nativeCache.set(id, { usd, at: Date.now() })
      return usd
    }
  } catch {
    /* use fallback */
  }
  nativeCache.set(id, { usd: fallback, at: Date.now() })
  return fallback
}
