import { Contract, Interface, JsonRpcProvider } from 'ethers'
import { CHAINS, getToken } from './chains'
import { hubMnemonic, treasuryEvmAddress, treasuryEvmWallet } from './addresses'

const ERC20 = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)'
]
const APPROVE = new Interface(ERC20)

async function main() {
  if (!hubMnemonic()) throw new Error('HUB_MNEMONIC missing')
  const chain = 'arbitrum' as const
  const usdc = getToken(chain, 'USDC')
  const usdt = getToken(chain, 'USDT')
  const cfg = CHAINS[chain]
  const url = process.env[cfg.rpcEnv] ?? cfg.defaultRpc
  if (!url) throw new Error('rpc_missing')
  const provider = new JsonRpcProvider(url, cfg.chainId, { staticNetwork: true })
  const wallet = treasuryEvmWallet().connect(provider)
  const me = treasuryEvmAddress()
  const token = new Contract(usdc.address, ERC20, provider)
  const amount = (await token.balanceOf(me)) as bigint
  if (amount <= 0n) throw new Error('no_usdc')

  const qurl = new URL('https://li.quest/v1/quote')
  qurl.searchParams.set('fromChain', String(cfg.chainId))
  qurl.searchParams.set('toChain', String(cfg.chainId))
  qurl.searchParams.set('fromToken', usdc.address)
  qurl.searchParams.set('toToken', usdt.address)
  qurl.searchParams.set('fromAmount', amount.toString())
  qurl.searchParams.set('fromAddress', me)
  qurl.searchParams.set('toAddress', me)
  qurl.searchParams.set('order', 'CHEAPEST')
  qurl.searchParams.set('slippage', '0.005')
  const quote = (await (await fetch(qurl)).json()) as {
    message?: string
    estimate?: { toAmount?: string; toAmountMin?: string; approvalAddress?: string }
    transactionRequest?: { to?: string; data?: string; value?: string }
    tool?: string
  }
  if (!quote.transactionRequest?.to || !quote.transactionRequest.data) {
    throw new Error(quote.message || 'no_quote')
  }
  const spender = quote.estimate?.approvalAddress || quote.transactionRequest.to
  const current = (await new Contract(usdc.address, ERC20, wallet).allowance(me, spender)) as bigint
  if (current < amount) {
    if (current > 0n) {
      const z = APPROVE.encodeFunctionData('approve', [spender, 0n])
      await (await wallet.sendTransaction({ to: usdc.address, data: z })).wait()
    }
    const a = APPROVE.encodeFunctionData('approve', [spender, amount])
    await (await wallet.sendTransaction({ to: usdc.address, data: a })).wait()
  }
  const tx = await wallet.sendTransaction({
    to: quote.transactionRequest.to,
    data: quote.transactionRequest.data,
    value: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : 0n
  })
  const mined = await tx.wait()
  const usdtC = new Contract(usdt.address, ERC20, provider)
  const usdcLeft = (await token.balanceOf(me)) as bigint
  const usdtHave = (await usdtC.balanceOf(me)) as bigint
  console.log(
    JSON.stringify({
      tool: quote.tool,
      tx: mined?.hash ?? tx.hash,
      fromUsdc: amount.toString(),
      minOut: quote.estimate?.toAmountMin,
      usdcLeft: usdcLeft.toString(),
      usdt: usdtHave.toString()
    })
  )
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e?.message ?? String(e) }))
  process.exit(1)
})
