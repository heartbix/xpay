import { Contract, Interface } from 'ethers'
import { CHAINS, SupportedChain, getToken } from './chains'
import { hubMnemonic, treasuryEvmAddress, treasuryEvmWallet } from './addresses'
import { withProvider } from './rpc'
import { pushOpsEvent } from './ops-events'
import { fromTokenUnits, toTokenUnits, treasuryUsdtAtomic, treasuryUsdtInventory } from './treasury-usdt'
import { receiptCostUsdtAtomic } from './tx-cost'

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
]
const APPROVE_IFACE = new Interface(ERC20_ABI)

type LifiQuote = {
  transactionRequest?: {
    to?: string
    data?: string
    value?: string
    gasLimit?: string
    gasPrice?: string
    chainId?: number
  }
  estimate?: {
    toAmount?: string
    toAmountMin?: string
    approvalAddress?: string
  }
  tool?: string
  message?: string
}

function routingEnabled(): boolean {
  return process.env.HUB_ROUTE_USDT !== '0'
}

async function lifiQuote(params: {
  fromChain: SupportedChain
  toChain: SupportedChain
  fromAmount: bigint
  fromAddress: string
}): Promise<LifiQuote> {
  const from = getToken(params.fromChain, 'USDT')
  const to = getToken(params.toChain, 'USDT')
  const url = new URL('https://li.quest/v1/quote')
  url.searchParams.set('fromChain', String(CHAINS[params.fromChain].chainId))
  url.searchParams.set('toChain', String(CHAINS[params.toChain].chainId))
  url.searchParams.set('fromToken', from.address)
  url.searchParams.set('toToken', to.address)
  url.searchParams.set('fromAmount', params.fromAmount.toString())
  url.searchParams.set('fromAddress', params.fromAddress)
  url.searchParams.set('toAddress', params.fromAddress)
  url.searchParams.set('order', 'CHEAPEST')
  url.searchParams.set('slippage', process.env.HUB_LIFI_SLIPPAGE ?? '0.005')
  const headers: Record<string, string> = { accept: 'application/json' }
  const key = process.env.HUB_LIFI_API_KEY?.trim()
  if (key) headers['x-lifi-api-key'] = key
  const res = await fetch(url, { headers })
  const body = (await res.json()) as LifiQuote
  if (!res.ok) throw new Error(body.message || `lifi_quote_${res.status}`)
  return body
}

async function lifiStatus(txHash: string, fromChain: SupportedChain, toChain: SupportedChain): Promise<string> {
  const url = new URL('https://li.quest/v1/status')
  url.searchParams.set('txHash', txHash)
  url.searchParams.set('fromChain', String(CHAINS[fromChain].chainId))
  url.searchParams.set('toChain', String(CHAINS[toChain].chainId))
  const res = await fetch(url)
  const body = (await res.json()) as { status?: string }
  return body.status ?? 'UNKNOWN'
}

async function waitRouted(txHash: string, fromChain: SupportedChain, toChain: SupportedChain, needAtomic: bigint) {
  const t0 = Date.now()
  while (Date.now() - t0 < 12 * 60_000) {
    try {
      const st = await lifiStatus(txHash, fromChain, toChain)
      if (st === 'DONE' || st === 'COMPLETED') {
        const have = await treasuryUsdtAtomic(toChain)
        if (have >= needAtomic) return
      }
      if (st === 'FAILED' || st === 'INVALID') throw new Error('route_failed')
    } catch (e: any) {
      if (e?.message === 'route_failed') throw e
    }
    const have = await treasuryUsdtAtomic(toChain)
    if (have >= needAtomic) return
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error('route_timeout')
}

async function ensureAllowance(
  chain: SupportedChain,
  token: string,
  spender: string,
  amount: bigint
) {
  const wallet = await withProvider(chain, async (provider) => treasuryEvmWallet().connect(provider))
  const c = new Contract(token, ERC20_ABI, wallet)
  const current = (await c.allowance(wallet.address, spender)) as bigint
  if (current >= amount) return
  if (current > 0n) {
    const data0 = APPROVE_IFACE.encodeFunctionData('approve', [spender, 0n])
    await (await wallet.sendTransaction({ to: token, data: data0 })).wait()
  }
  const data = APPROVE_IFACE.encodeFunctionData('approve', [spender, amount])
  await (await wallet.sendTransaction({ to: token, data })).wait()
}

async function executeQuote(
  fromChain: SupportedChain,
  quote: LifiQuote,
  fromAmount: bigint
): Promise<{ hash: string; gasAtomic: string }> {
  const req = quote.transactionRequest
  if (!req?.to || !req.data) throw new Error('route_no_tx')
  const wallet = await withProvider(fromChain, async (provider) => treasuryEvmWallet().connect(provider))
  const spender = quote.estimate?.approvalAddress || req.to
  const fromToken = getToken(fromChain, 'USDT')
  await ensureAllowance(fromChain, fromToken.address, spender, fromAmount)
  const tx = await wallet.sendTransaction({
    to: req.to,
    data: req.data,
    value: req.value ? BigInt(req.value) : 0n
  })
  const mined = await tx.wait()
  return {
    hash: mined?.hash ?? tx.hash,
    gasAtomic: await receiptCostUsdtAtomic(fromChain, mined)
  }
}

export type RouteSpend = {
  routeTxHash?: string
  fromChain?: SupportedChain
  hopAtomic: string
  gasAtomic: string
}

/**
 * Make sure treasury holds at least `needAtomic` (6 decimals) USDT on `dest`.
 * Moves USDT from other hub treasuries via Li.Fi when needed.
 */
export async function ensureUsdtOnChain(dest: SupportedChain, needAtomic: bigint): Promise<RouteSpend> {
  const empty: RouteSpend = { hopAtomic: '0', gasAtomic: '0' }
  if (needAtomic <= 0n) return empty
  const have = await treasuryUsdtAtomic(dest)
  if (have >= needAtomic) return empty
  if (!routingEnabled()) throw new Error('treasury_usdt_short')
  if (!hubMnemonic()) throw new Error('HUB_MNEMONIC missing')

  const shortfall = needAtomic - have
  const inventory = (await treasuryUsdtInventory())
    .filter((row) => row.chain !== dest && row.atomic > 0n)
    .sort((a, b) => (a.atomic < b.atomic ? 1 : a.atomic > b.atomic ? -1 : 0))
  if (inventory.length === 0) throw new Error('treasury_usdt_short')

  const treasury = treasuryEvmAddress()
  for (const src of inventory) {
    const srcToken = getToken(src.chain, 'USDT')
    const destToken = getToken(dest, 'USDT')
    const bump = (shortfall * 103n) / 100n + 10_000n
    const attempts = [bump > src.atomic ? src.atomic : bump]
    if (attempts[0] < src.atomic) attempts.push(src.atomic)
    for (const fromAtomic of attempts) {
      const fromAmount = toTokenUnits(fromAtomic, srcToken.decimals)
      if (fromAmount <= 0n) continue
      try {
        const quote = await lifiQuote({
          fromChain: src.chain,
          toChain: dest,
          fromAmount,
          fromAddress: treasury
        })
        const minOut = BigInt(quote.estimate?.toAmountMin || quote.estimate?.toAmount || '0')
        const minAtomic = fromTokenUnits(minOut, destToken.decimals)
        if (minAtomic + have < needAtomic) continue
        pushOpsEvent({
          kind: 'payout',
          status: 'scheduled',
          title: 'Routing USDT',
          detail: `${src.chain} → ${dest}`,
          chain: dest
        })
        const sent = await executeQuote(src.chain, quote, fromAmount)
        await waitRouted(sent.hash, src.chain, dest, needAtomic)
        const after = await treasuryUsdtAtomic(dest)
        const received = after > have ? after - have : 0n
        const hop = fromAtomic > received ? fromAtomic - received : 0n
        return {
          routeTxHash: sent.hash,
          fromChain: src.chain,
          hopAtomic: hop.toString(),
          gasAtomic: sent.gasAtomic
        }
      } catch (e: any) {
        console.error(`[route-usdt] ${src.chain}→${dest}:`, e?.message ?? e)
      }
    }
  }
  const after = await treasuryUsdtAtomic(dest)
  if (after >= needAtomic) return empty
  throw new Error('treasury_usdt_short')
}
