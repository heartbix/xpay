import { JsonRpcProvider, formatUnits, id, Interface, zeroPadValue } from 'ethers'
import { v4 as uuidv4 } from 'uuid'
import { CHAINS, SupportedChain, TokenConfig, isSupportedChain } from './chains'
import { creditVaultOnAlephium } from './credit'
import { isBelowMinDeposit } from './fees'
import { attachFeeQuote } from './ledger'
import { pushOpsEvent } from './ops-events'
import { findAddress, findDepositByTx, listAddresses, saveDeposit } from './store'
import { providerFor } from './rpc'
import { retryUnsweptDeposits, sweepDepositToTreasury } from './sweep'

const ERC20_IFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)')

function toTopics(addresses: string[]): string[] {
  return addresses.map((a) => zeroPadValue(a, 32))
}

function toVaultAtomic(amount: bigint, decimals: number): string {
  if (decimals === 6) return amount.toString()
  if (decimals > 6) return (amount / 10n ** BigInt(decimals - 6)).toString()
  return (amount * 10n ** BigInt(6 - decimals)).toString()
}

async function scanToken(chain: SupportedChain, token: TokenConfig, lookbackBlocks: number) {
  const watched = listAddresses()
    .filter((a) => a.chain === chain)
    .map((a) => a.address)
  if (watched.length === 0) return

  const provider = providerFor(chain)
  const latest = await provider.getBlockNumber()
  const toBlock = Math.max(0, latest - 12)
  const fromBlock = Math.max(0, toBlock - lookbackBlocks)
  if (fromBlock > toBlock) return

  const topics = [TRANSFER_TOPIC, null, toTopics(watched)]
  const chunk = LOG_CHUNK[chain]
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(toBlock, start + chunk - 1)
    const logs = await getLogsChunk(provider, token.address, start, end, topics)
    for (const log of logs) {
      const parsed = ERC20_IFACE.parseLog({ topics: log.topics as string[], data: log.data })
      if (!parsed) continue
      await recordTransfer(chain, token, log.transactionHash, String(parsed.args.to), parsed.args.value as bigint)
    }
  }
}

async function getLogsChunk(
  provider: JsonRpcProvider,
  address: string,
  fromBlock: number,
  toBlock: number,
  topics: (string | null | string[])[]
) {
  let to = toBlock
  for (let attempt = 0; attempt < 4; attempt++) {
    const from = Math.min(fromBlock, to)
    try {
      return await provider.getLogs({ address, fromBlock: from, toBlock: to, topics })
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      const head = msg.match(/head(?: block:)?\s*(\d+)/i)
      if (head) {
        to = Math.max(0, Number(head[1]) - 1)
        if (to < fromBlock) return []
        continue
      }
      throw e
    }
  }
  return []
}

async function recordTransfer(
  chain: SupportedChain,
  token: TokenConfig,
  txHash: string,
  to: string,
  amount: bigint
) {
  const owner = findAddress(chain, to)
  if (!owner) return
  if (findDepositByTx(chain, txHash)) return

  const amountUsdt = formatUnits(amount, token.decimals)
  const amountAtomic = toVaultAtomic(amount, token.decimals)

  pushOpsEvent({
    kind: 'deposit',
    status: 'detected',
    title: 'Deposit detected',
    detail: `${amountUsdt} ${token.symbol} on ${chain}`,
    txId: txHash,
    chain
  })
  let deposit = saveDeposit({
    id: uuidv4(),
    userId: owner.userId,
    chain,
    token: token.symbol,
    txHash,
    amountAtomic,
    amountUsdt,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  deposit = await attachFeeQuote(deposit)
  if (isBelowMinDeposit(deposit.amountAtomic)) {
    deposit.status = 'failed'
    deposit.error = 'below_minimum_deposit'
    deposit.updatedAt = new Date().toISOString()
    saveDeposit(deposit)
    console.log(`[watcher] ${chain} ${token.symbol} below minimum ${amountUsdt} tx=${txHash}`)
    return
  }

  if (process.env.HUB_AUTO_CREDIT === '1') {
    deposit = await creditVaultOnAlephium(deposit)
  }
  if (deposit.status === 'credited') {
    deposit = await sweepDepositToTreasury(deposit, owner.derivationIndex, amount)
  }

  console.log(
    `[watcher] ${chain} ${token.symbol} deposit ${amountUsdt} -> user ${owner.userId} tx=${txHash} status=${deposit.status}`
  )
}

export async function ingestTx(chain: SupportedChain, txHash: string) {
  const provider = providerFor(chain)
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) throw new Error('tx_not_found')
  for (const token of Object.values(CHAINS[chain].tokens)) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token.address.toLowerCase()) continue
      const parsed = ERC20_IFACE.parseLog({ topics: log.topics as string[], data: log.data })
      if (!parsed || parsed.name !== 'Transfer') continue
      await recordTransfer(chain, token, txHash, String(parsed.args.to), parsed.args.value as bigint)
    }
  }
}

/** Catch-up window. Keep modest so public RPCs do not 403 archive. */
const LOOKBACK_BLOCKS: Record<SupportedChain, number> = {
  ethereum: 80,
  bsc: 600,
  polygon: 200,
  arbitrum: 400,
  base: 200
}

const LOG_CHUNK: Record<SupportedChain, number> = {
  ethereum: 40,
  bsc: 40,
  polygon: 40,
  arbitrum: 80,
  base: 40
}

export async function scanChain(chain: SupportedChain, lookbackBlocks = LOOKBACK_BLOCKS[chain]) {
  for (const token of Object.values(CHAINS[chain].tokens)) {
    await scanToken(chain, token, lookbackBlocks)
  }
}

async function main() {
  const chains = (process.env.HUB_WATCH_CHAINS ?? 'ethereum,bsc')
    .split(',')
    .map((s) => s.trim())
    .filter(isSupportedChain)

  console.log(`Hub watcher starting for: ${chains.join(', ')} (USDT + USDC)`)
  for (;;) {
    for (const chain of chains) {
      try {
        await scanChain(chain)
      } catch (e: any) {
        console.error(`[watcher] ${chain} error:`, e?.message ?? e)
      }
    }
    try {
      await retryUnsweptDeposits()
    } catch (e: any) {
      console.error('[watcher] unswept retry:', e?.message ?? e)
    }
    await new Promise((r) => setTimeout(r, Number(process.env.HUB_POLL_MS ?? 15000)))
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
