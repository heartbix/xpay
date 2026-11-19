import { Contract } from 'ethers'
import { CHAINS, SupportedChain, getToken } from './chains'
import { treasuryEvmAddress } from './addresses'
import { withProvider } from './rpc'

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)']

export function toTokenUnits(usdtAtomic: string | bigint, decimals: number): bigint {
  const n = BigInt(usdtAtomic || '0')
  if (decimals === 6) return n
  if (decimals > 6) return n * 10n ** BigInt(decimals - 6)
  return n / 10n ** BigInt(6 - decimals)
}

export function fromTokenUnits(amount: bigint, decimals: number): bigint {
  if (decimals === 6) return amount
  if (decimals > 6) return amount / 10n ** BigInt(decimals - 6)
  return amount * 10n ** BigInt(6 - decimals)
}

export async function treasuryUsdtRaw(chain: SupportedChain): Promise<bigint> {
  const token = getToken(chain, 'USDT')
  return withProvider(chain, async (provider) => {
    const c = new Contract(token.address, ERC20_ABI, provider)
    return (await c.balanceOf(treasuryEvmAddress())) as bigint
  })
}

export async function treasuryUsdtAtomic(chain: SupportedChain): Promise<bigint> {
  const token = getToken(chain, 'USDT')
  const raw = await treasuryUsdtRaw(chain)
  return fromTokenUnits(raw, token.decimals)
}

export async function treasuryUsdtInventory(): Promise<{ chain: SupportedChain; atomic: bigint; raw: bigint }[]> {
  const chains = Object.keys(CHAINS) as SupportedChain[]
  return Promise.all(
    chains.map(async (chain) => {
      try {
        const token = getToken(chain, 'USDT')
        const raw = await treasuryUsdtRaw(chain)
        return { chain, raw, atomic: fromTokenUnits(raw, token.decimals) }
      } catch (e: any) {
        console.error(`[treasury] ${chain} USDT balance failed:`, e?.message ?? e)
        return { chain, raw: 0n, atomic: 0n }
      }
    })
  )
}
