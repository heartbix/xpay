import { JsonRpcProvider } from 'ethers'
import { CHAINS, SupportedChain } from './chains'

const cache = new Map<string, JsonRpcProvider>()

export function rpcUrls(chain: SupportedChain): string[] {
  const cfg = CHAINS[chain]
  const env = process.env[cfg.rpcEnv]?.trim()
  const list = [env, cfg.defaultRpc, ...(cfg.rpcFallbacks ?? [])].filter(
    (u): u is string => typeof u === 'string' && u.length > 0
  )
  return [...new Set(list)]
}

export function providerAt(chain: SupportedChain, url: string): JsonRpcProvider {
  const key = `${chain}:${url}`
  const hit = cache.get(key)
  if (hit) return hit
  const provider = new JsonRpcProvider(url, CHAINS[chain].chainId, { staticNetwork: true })
  cache.set(key, provider)
  return provider
}

export function providerFor(chain: SupportedChain): JsonRpcProvider {
  const urls = rpcUrls(chain)
  if (urls.length === 0) throw new Error(`Missing RPC for ${chain}`)
  return providerAt(chain, urls[0])
}

export async function withProvider<T>(
  chain: SupportedChain,
  fn: (provider: JsonRpcProvider) => Promise<T>
): Promise<T> {
  const urls = rpcUrls(chain)
  if (urls.length === 0) throw new Error(`Missing RPC for ${chain}`)
  let last: unknown
  for (const url of urls) {
    try {
      return await fn(providerAt(chain, url))
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
