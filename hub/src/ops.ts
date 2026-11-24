import { Contract, formatUnits } from 'ethers'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { web3 } from '@alephium/web3'
import { CHAINS, SupportedChain } from './chains'
import { treasuryEvmAddress } from './addresses'
import { ceilUsdToUsdtAtomic, hopFeeUsd, quoteWithdrawFee, quoteX402Fee, sweepFeeUsd, vaultAlphFeeAmount } from './fees'
import { withProvider } from './rpc'
import { OpsEvent, listOpsEvents } from './ops-events'
import {
  availableBalanceAtomic,
  getNextAlphIndex,
  getNextEvmIndex,
  listAddresses,
  listDeposits,
  listPayouts,
  listUsers,
  listX402Payments,
  saveDeposit,
  savePayout
} from './store'
import { hopCostForPayout } from './across'
import { evmTxCostUsdtAtomic } from './tx-cost'

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)']

const NATIVE: Record<SupportedChain, { symbol: string; warn: number }> = {
  ethereum: { symbol: 'ETH', warn: 0.03 },
  bsc: { symbol: 'BNB', warn: 0.02 },
  polygon: { symbol: 'POL', warn: 2 },
  arbitrum: { symbol: 'ETH', warn: 0.005 },
  base: { symbol: 'ETH', warn: 0.005 }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

function formatToken(amount: bigint, decimals: number): string {
  const raw = formatUnits(amount, decimals)
  const [w, f = ''] = raw.split('.')
  return f.replace(/0+$/, '') ? `${w}.${f.slice(0, 6).replace(/0+$/, '')}` : w
}

async function chainTreasury(chain: SupportedChain, treasury: string) {
  const cfg = CHAINS[chain]
  const native = NATIVE[chain]
  return withProvider(chain, async (provider) => {
    const gasWei = await withTimeout(provider.getBalance(treasury), 8000)
    const gas = Number(formatUnits(gasWei, 18))
    const tokens: { symbol: string; amount: string }[] = []
    for (const token of Object.values(cfg.tokens)) {
      const c = new Contract(token.address, ERC20_ABI, provider)
      const bal = (await withTimeout(c.balanceOf(treasury) as Promise<bigint>, 8000)) as bigint
      tokens.push({
        symbol: token.symbol,
        amount: formatToken(bal, token.decimals)
      })
    }
    return {
      chain,
      name: cfg.name,
      nativeSymbol: native.symbol,
      native: formatToken(gasWei, 18),
      nativeLow: gas < native.warn,
      nativeWarnAt: String(native.warn),
      tokens,
      withdrawFeeUsd: Number((await quoteWithdrawFee(chain)).totalUsdtAtomic) / 1e6,
      error: undefined as string | undefined
    }
  })
}

async function alphSnapshot() {
  const nodeUrl = process.env.ALEPHIUM_NODE_URL ?? 'https://node.testnet.alephium.org'
  web3.setCurrentNodeProvider(nodeUrl)
  const key = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!key) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  const wallet = new PrivateKeyWallet({ privateKey: key })
  const info = await withTimeout(
    web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(wallet.address),
    8000
  )
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: {
        PaymentVault: { contractInstance: { address: string } }
        MockUSDT: { contractInstance: { contractId: string; address: string } }
      }
    }
  }
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  const deployments = loadDeployments(network)
  const musdtId = deployments.contracts.MockUSDT.contractInstance.contractId
  const musdt = (info.tokenBalances ?? []).find((t) => (t as { id?: string; tokenId?: string }).id === musdtId || (t as { tokenId?: string }).tokenId === musdtId)
  const alph = Number(info.balance) / 1e18
  return {
    network,
    address: wallet.address,
    alph: (Number(info.balance) / 1e18).toFixed(4),
    alphLocked: (Number(info.lockedBalance) / 1e18).toFixed(4),
    alphLow: alph < 1,
    musdt: musdt ? (Number(musdt.amount) / 1e6).toFixed(6) : '0',
    vaultAddress: deployments.contracts.PaymentVault.contractInstance.address,
    mockUsdtAddress: deployments.contracts.MockUSDT.contractInstance.address
  }
}

export async function platformSnapshot() {
  const warnings: string[] = []
  let treasury = ''
  try {
    treasury = treasuryEvmAddress()
  } catch (e: any) {
    warnings.push(e?.message ?? 'treasury_unconfigured')
  }

  const chains = await Promise.all(
    (Object.keys(CHAINS) as SupportedChain[]).map(async (chain) => {
      if (!treasury) {
        return {
          chain,
          name: CHAINS[chain].name,
          nativeSymbol: NATIVE[chain].symbol,
          native: '—',
          nativeLow: true,
          nativeWarnAt: String(NATIVE[chain].warn),
          tokens: [],
          withdrawFeeUsd: sweepFeeUsd(chain) * 2 + hopFeeUsd(chain),
          error: 'treasury_unconfigured'
        }
      }
      try {
        return await chainTreasury(chain, treasury)
      } catch (e: any) {
        return {
          chain,
          name: CHAINS[chain].name,
          nativeSymbol: NATIVE[chain].symbol,
          native: '—',
          nativeLow: true,
          nativeWarnAt: String(NATIVE[chain].warn),
          tokens: [],
          withdrawFeeUsd: sweepFeeUsd(chain) * 2 + hopFeeUsd(chain),
          error: e?.message ?? 'rpc_failed'
        }
      }
    })
  )

  for (const row of chains) {
    if (row.error) warnings.push(`${row.name}: ${row.error}`)
    else if (row.nativeLow) warnings.push(`${row.name}: low ${row.nativeSymbol} (${row.native}, warn < ${row.nativeWarnAt})`)
  }

  let alph
  try {
    alph = await alphSnapshot()
    if (alph.alphLow) warnings.push(`Alephium: low ALPH (${alph.alph})`)
  } catch (e: any) {
    alph = undefined
    warnings.push(`Alephium: ${e?.message ?? 'node_failed'}`)
  }

  const users = listUsers()
  const userLabel = (userId: string) => {
    const u = users.find((row) => row.userId === userId)
    return u?.email || u?.name || userId.slice(0, 8)
  }
  const deposits = listDeposits()
  const payouts = listPayouts()
  const x402 = listX402Payments()
  const received = x402.filter((p) => (p.direction || 'received') === 'received')
  const sent = x402.filter((p) => p.direction === 'sent')

  const topHolders = users
    .map((u) => ({
      userId: u.userId,
      label: u.email || u.name || u.userId.slice(0, 8),
      balanceAtomic: availableBalanceAtomic(u.userId).toString()
    }))
    .sort((a, b) => (BigInt(b.balanceAtomic) > BigInt(a.balanceAtomic) ? 1 : BigInt(b.balanceAtomic) < BigInt(a.balanceAtomic) ? -1 : 0))
    .slice(0, 20)

  const flow = new Map<
    string,
    { userId: string; label: string; paidAtomic: bigint; receivedAtomic: bigint; paidCount: number; receivedCount: number }
  >()
  const bumpFlow = (userId: string, dir: 'sent' | 'received', atomic: bigint) => {
    const cur = flow.get(userId) ?? {
      userId,
      label: userLabel(userId),
      paidAtomic: 0n,
      receivedAtomic: 0n,
      paidCount: 0,
      receivedCount: 0
    }
    if (dir === 'sent') {
      cur.paidAtomic += atomic
      cur.paidCount += 1
    } else {
      cur.receivedAtomic += atomic
      cur.receivedCount += 1
    }
    flow.set(userId, cur)
  }
  for (const p of x402) {
    const atomic = BigInt(p.totalAtomic || p.priceAtomic || '0')
    const dir = p.direction === 'sent' ? 'sent' : 'received'
    bumpFlow(p.userId, dir, atomic)
  }
  const topPaidReceive = [...flow.values()]
    .map((row) => ({
      ...row,
      paidAtomic: row.paidAtomic.toString(),
      receivedAtomic: row.receivedAtomic.toString(),
      totalAtomic: (row.paidAtomic + row.receivedAtomic).toString()
    }))
    .sort((a, b) => (BigInt(b.totalAtomic) > BigInt(a.totalAtomic) ? 1 : -1))
    .slice(0, 20)

  const depositRows = await Promise.all(
    deposits.map(async (d) => {
      let costAtomic = d.costUsdtAtomic || '0'
      if (costAtomic === '0' && d.sweepTxHash && d.status === 'credited') {
        costAtomic = await evmTxCostUsdtAtomic(d.chain, d.sweepTxHash)
        if (costAtomic !== '0') {
          d.costUsdtAtomic = costAtomic
          saveDeposit(d)
        }
      }
      const feeAtomic = d.feeAtomic || '0'
      const countPnl = d.status === 'credited'
      return {
        id: d.id,
        at: d.createdAt,
        kind: 'deposit' as const,
        direction: 'in',
        label: userLabel(d.userId),
        detail: `${d.token || 'USDT'} ${d.chain}`,
        amountAtomic: d.netAtomic || d.amountAtomic || '0',
        feeAtomic,
        costAtomic,
        pnlAtomic: countPnl ? (BigInt(feeAtomic) - BigInt(costAtomic)).toString() : '0',
        status: d.status,
        txId: d.txHash,
        chain: d.chain,
        httpMs: undefined as number | undefined,
        chainAt: undefined as string | undefined
      }
    })
  )

  const payoutRows = await Promise.all(
    payouts.map(async (p) => {
      let costAtomic = p.costUsdtAtomic || '0'
      if (p.status === 'sent' && p.txHash && p.hopUsdtAtomic === undefined) {
        const destGas =
          costAtomic !== '0' ? costAtomic : await evmTxCostUsdtAtomic(p.chain, p.txHash)
        const hop = await hopCostForPayout({ dest: p.chain, at: p.updatedAt || p.createdAt })
        if (hop) {
          p.routeTxHash = hop.routeTxHash
          p.hopUsdtAtomic = hop.hopAtomic
          costAtomic = (BigInt(destGas || '0') + BigInt(hop.gasAtomic) + BigInt(hop.hopAtomic)).toString()
        } else {
          p.hopUsdtAtomic = '0'
          costAtomic = destGas
        }
        p.costUsdtAtomic = costAtomic
        savePayout(p)
      }
      const feeAtomic = p.feeAtomic || '0'
      const hopAtomic = p.hopUsdtAtomic || '0'
      const gasPart = BigInt(costAtomic || '0') - BigInt(hopAtomic || '0')
      const gasAtomic = gasPart > 0n ? gasPart.toString() : '0'
      const countPnl = p.status === 'sent'
      return {
        id: p.id,
        at: p.createdAt,
        kind: 'payout' as const,
        direction: 'out',
        label: userLabel(p.userId),
        detail: `${p.token} ${p.chain}`,
        amountAtomic: p.netAtomic || p.amountAtomic || '0',
        feeAtomic,
        costAtomic,
        hopAtomic,
        gasAtomic,
        pnlAtomic: countPnl ? (BigInt(feeAtomic) - BigInt(costAtomic)).toString() : '0',
        status: p.status,
        txId: p.txHash,
        chain: p.chain,
        httpMs: undefined as number | undefined,
        chainAt: undefined as string | undefined
      }
    })
  )

  const x402Rows = x402.map((p) => {
    const received = (p.direction || 'received') !== 'sent'
    const feeAtomic = received ? p.feeAtomic || '0' : '0'
    let costAtomic = '0'
    if (received) {
      const gasAlph = Number(p.gasAlph || 0)
      const alphUsd = Number(p.alphUsd || 0)
      if (gasAlph > 0 && alphUsd > 0) costAtomic = ceilUsdToUsdtAtomic(gasAlph * alphUsd).toString()
      else if (p.gasFeeAtomic && p.gasFeeAtomic !== '0') costAtomic = p.gasFeeAtomic
    }
    const settled = received && (p.chainStatus || 'paid') !== 'failed'
    return {
      id: p.id,
      at: p.createdAt,
      kind: 'x402' as const,
      direction: p.direction === 'sent' ? 'paid' : 'received',
      label: userLabel(p.userId),
      detail: p.slug,
      amountAtomic: p.totalAtomic || p.priceAtomic || '0',
      feeAtomic,
      costAtomic,
      pnlAtomic: settled ? (BigInt(feeAtomic) - BigInt(costAtomic)).toString() : '0',
      status: p.chainStatus || 'paid',
      txId: p.txId,
      chain: undefined as string | undefined,
      httpMs: p.httpMs,
      chainAt: p.chainAt
    }
  })

  const history = [...x402Rows, ...depositRows, ...payoutRows]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 2500)
  const historyPnl = history.reduce(
    (acc, row) => {
      acc.fee += BigInt(row.feeAtomic || '0')
      acc.cost += BigInt(row.costAtomic || '0')
      acc.pnl += BigInt(row.pnlAtomic || '0')
      return acc
    },
    { fee: 0n, cost: 0n, pnl: 0n }
  )
  const x402Fees = received.reduce((n, p) => {
    const fee = BigInt(p.feeAtomic || '0')
    if (fee > 0n) return n + fee
    const total = BigInt(p.totalAtomic || '0')
    const price = BigInt(p.priceAtomic || '0')
    return n + (total > price ? total - price : 0n)
  }, 0n)
  const withdrawFees = payouts
    .filter((p) => p.status !== 'failed')
    .reduce((n, p) => n + BigInt(p.feeAtomic || '0'), 0n)
  const depositFees = deposits
    .filter((d) => d.status === 'credited')
    .reduce((n, p) => n + BigInt(p.feeAtomic || '0'), 0n)
  const liabilities = users.reduce((n, u) => n + availableBalanceAtomic(u.userId), 0n)
  const x402Volume = received.reduce((n, p) => n + BigInt(p.totalAtomic || p.priceAtomic || '0'), 0n)

  const x402Fee = await quoteX402Fee()
  const sampleWithdraw = await quoteWithdrawFee('ethereum')

  // Real vs mock USDT deviation. Mock USDT is minted on Alephium for the
  // simulation; real USDT is what the treasury actually holds on EVM chains.
  // The gap between user liabilities and real backing is the exposure.
  const realUsdtAtomic = chains.reduce((n, row) => {
    for (const t of row.tokens ?? []) {
      if (t.symbol === 'USDT') n += BigInt(Math.round(Number(t.amount) * 1e6))
    }
    return n
  }, 0n)
  const mockUsdtAtomic = alph?.musdt ? BigInt(Math.round(Number(alph.musdt) * 1e6)) : 0n
  const deviationAtomic = liabilities - realUsdtAtomic
  const deviationPct =
    realUsdtAtomic > 0n ? Number((deviationAtomic * 10000n) / realUsdtAtomic) / 100 : liabilities > 0n ? 100 : 0

  return {
    generatedAt: new Date().toISOString(),
    network: process.env.ALEPHIUM_NETWORK ?? 'testnet',
    usdtDeviation: {
      realUsdtAtomic: realUsdtAtomic.toString(),
      mockUsdtAtomic: mockUsdtAtomic.toString(),
      userLiabilitiesAtomic: liabilities.toString(),
      deviationAtomic: deviationAtomic.toString(),
      deviationPct,
      covered: deviationAtomic <= 0n,
      note: 'real = treasury USDT on EVM chains; mock = MockUSDT on Alephium; liabilities = sum of user balances'
    },
    watchChains: (process.env.HUB_WATCH_CHAINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    autoSweep: process.env.HUB_AUTO_SWEEP === '1',
    autoCredit: process.env.HUB_AUTO_CREDIT === '1',
    demoSeed: !process.env.HUB_MNEMONIC?.trim(),
    treasury,
    alph,
    chains,
    warnings,
    gains: {
      x402FeesAtomic: x402Fees.toString(),
      withdrawFeesAtomic: withdrawFees.toString(),
      depositFeesAtomic: depositFees.toString(),
      totalAtomic: (x402Fees + withdrawFees + depositFees).toString()
    },
    books: {
      users: users.length,
      depositAddresses: listAddresses().length,
      nextEvmIndex: getNextEvmIndex(),
      nextAlphIndex: getNextAlphIndex(),
      deposits: deposits.length,
      creditedDeposits: deposits.filter((d) => d.status === 'credited').length,
      failedDeposits: deposits.filter((d) => d.status === 'failed').length,
      payouts: payouts.length,
      x402Payments: x402.length,
      x402Received: received.length,
      x402Sent: sent.length,
      x402VolumeAtomic: x402Volume.toString(),
      userLiabilitiesAtomic: liabilities.toString()
    },
    topHolders,
    topPaidReceive,
    history,
    historyPnl: {
      feeAtomic: historyPnl.fee.toString(),
      costAtomic: historyPnl.cost.toString(),
      pnlAtomic: historyPnl.pnl.toString()
    },
    fees: {
      x402: x402Fee,
      withdrawEth: sampleWithdraw,
      vaultAlph: vaultAlphFeeAmount()
    },
    recentDeposits: deposits
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12)
      .map((d) => ({
        createdAt: d.createdAt,
        chain: d.chain,
        token: d.token,
        amountUsdt: d.amountUsdt,
        status: d.status,
        txHash: d.txHash
      })),
    recentPayouts: payouts.slice(0, 12).map((p) => ({
      createdAt: p.createdAt,
      chain: p.chain,
      token: p.token,
      netAtomic: p.netAtomic,
      feeAtomic: p.feeAtomic,
      status: p.status,
      txHash: p.txHash
    })),
    recentX402: received.map((p) => ({
      createdAt: p.createdAt,
      slug: p.slug,
      totalAtomic: p.totalAtomic,
      feeAtomic: p.feeAtomic,
      txId: p.txId,
      httpMs: p.httpMs,
      chainAt: p.chainAt,
      chainStatus: p.chainStatus
    })),
    activity: mergeActivity(received, deposits, payouts)
  }
}

function mergeActivity(
  received: ReturnType<typeof listX402Payments>,
  deposits: ReturnType<typeof listDeposits>,
  payouts: ReturnType<typeof listPayouts>
): OpsEvent[] {
  const live = listOpsEvents()
  const seen = new Set(live.map((e) => e.txId).filter(Boolean) as string[])
  const derived: OpsEvent[] = []
  for (const p of received.slice(0, 15)) {
    if (p.txId && seen.has(p.txId)) continue
    derived.push({
      id: p.id,
      at: p.createdAt,
      kind: 'x402',
      status: 'settled',
      title: 'X402 payment',
      detail: `${p.slug} · ${p.totalAtomic} atomic`,
      txId: p.txId
    })
  }
  for (const d of deposits.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15)) {
    if (seen.has(d.txHash)) continue
    derived.push({
      id: d.id,
      at: d.updatedAt || d.createdAt,
      kind: 'deposit',
      status: d.status,
      title: `Deposit ${d.status}`,
      detail: `${d.amountUsdt} ${d.token || 'USDT'} on ${d.chain}`,
      txId: d.txHash,
      chain: d.chain
    })
  }
  for (const p of payouts.slice(0, 15)) {
    if (p.txHash && seen.has(p.txHash)) continue
    derived.push({
      id: p.id,
      at: p.updatedAt || p.createdAt,
      kind: 'payout',
      status: p.status,
      title: `Withdraw ${p.status}`,
      detail: `${p.token} on ${p.chain}`,
      txId: p.txHash,
      chain: p.chain
    })
  }
  return [...live, ...derived].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
}
