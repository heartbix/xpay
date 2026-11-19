import { treasuryEvmAddress } from './addresses'
import { CHAINS, chainByChainId, getToken, SupportedChain } from './chains'
import { ceilUsdToUsdtAtomic } from './fees'
import { fromTokenUnits } from './treasury-usdt'
import { evmTxCostUsdtAtomic } from './tx-cost'

type AcrossDeposit = {
  originChainId?: number | string
  destinationChainId?: number | string
  depositTxHash?: string
  fillTx?: string
  fillTxnRef?: string
  inputAmount?: string
  outputAmount?: string
  fillBlockTimestamp?: string
  depositBlockTimestamp?: string
  bridgeFeeUsd?: string
}

function asChainId(v: number | string | undefined): number {
  return Number(v || 0)
}

export async function hopCostForPayout(params: {
  dest: SupportedChain
  at: string
}): Promise<{ hopAtomic: string; gasAtomic: string; routeTxHash?: string } | undefined> {
  const treasury = treasuryEvmAddress().toLowerCase()
  const at = new Date(params.at).getTime()
  if (!Number.isFinite(at)) return
  try {
    const url = new URL('https://across.to/api/deposits')
    url.searchParams.set('depositor', treasury)
    url.searchParams.set('limit', '15')
    const res = await fetch(url)
    if (!res.ok) return
    const rows = (await res.json()) as AcrossDeposit[]
    const destId = CHAINS[params.dest].chainId
    const match = rows.find((d) => {
      const dest = asChainId(d.destinationChainId)
      const ts = new Date(d.fillBlockTimestamp || d.depositBlockTimestamp || 0).getTime()
      if (dest !== destId) return false
      return Math.abs(ts - at) < 4 * 60_000
    })
    if (!match) return
    const origin = chainByChainId(asChainId(match.originChainId))
    const out = BigInt(match.outputAmount || '0')
    let hopAtomic = ceilUsdToUsdtAtomic(Number(match.bridgeFeeUsd || 0))
    if (origin && match.inputAmount) {
      const srcToken = getToken(origin, 'USDT')
      const inn = fromTokenUnits(BigInt(match.inputAmount), srcToken.decimals)
      if (inn > out) hopAtomic = inn - out
    }
    const routeTxHash = match.depositTxHash
    let gasAtomic = 0n
    if (origin && routeTxHash) {
      gasAtomic = BigInt(await evmTxCostUsdtAtomic(origin, routeTxHash))
    }
    return {
      hopAtomic: hopAtomic.toString(),
      gasAtomic: gasAtomic.toString(),
      routeTxHash
    }
  } catch {
    return
  }
}
