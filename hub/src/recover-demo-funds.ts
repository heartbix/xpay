/**
 * Move tokens off Hardhat-demo deposit addresses onto the real treasury, credit the vault,
 * then rotate Fund addresses to HUB_MNEMONIC.
 *
 * Run on the VPS with hub env loaded. Never logs keys.
 */
import { Contract, Interface, JsonRpcProvider, formatUnits } from 'ethers'
import { v4 as uuidv4 } from 'uuid'
import { demoEvmWallet, deriveEvmDepositAddress, hubMnemonic, isDemoEvmAddress, treasuryEvmAddress, treasuryEvmWallet } from './addresses'
import { CHAINS, SupportedChain, TokenSymbol } from './chains'
import { creditVaultOnAlephium } from './credit'
import { findDepositByTx, listAddresses, saveDeposit, unifyUserDepositAddress } from './store'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
]
const TRANSFER_IFACE = new Interface(['function transfer(address to, uint256 amount)'])

const KNOWN_TX: Record<string, string> = {
  'arbitrum:0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc:USDC':
    '0x5ab57ce3bbdd5326abd44625975456cbc140371139cdbd3b6ee056591036f330'
}

function providerFor(chain: SupportedChain): JsonRpcProvider {
  const cfg = CHAINS[chain]
  const url = process.env[cfg.rpcEnv] ?? cfg.defaultRpc
  if (!url) throw new Error(`Missing RPC for ${chain}`)
  return new JsonRpcProvider(url, cfg.chainId, { staticNetwork: true })
}

async function transferToken(params: {
  chain: SupportedChain
  tokenAddress: string
  child: ReturnType<typeof demoEvmWallet>
  treasury: ReturnType<typeof treasuryEvmWallet>
  amount: bigint
}) {
  const provider = params.child.provider
  if (!provider) throw new Error('no_provider')
  const fee = await provider.getFeeData()
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n
  const gasNeed = gasPrice * 120_000n
  const native = await provider.getBalance(params.child.address)
  if (native < gasNeed) {
    const topUp = gasNeed * 3n
    const treasuryBal = await provider.getBalance(params.treasury.address)
    if (treasuryBal < topUp) {
      throw new Error(`treasury_native_low need ${topUp.toString()} on ${params.chain}`)
    }
    const gasTx = await params.treasury.sendTransaction({ to: params.child.address, value: topUp })
    await gasTx.wait()
    console.log(`[recover] gas top-up ${params.chain} ${gasTx.hash}`)
  }

  const data = TRANSFER_IFACE.encodeFunctionData('transfer', [treasuryEvmAddress(), params.amount])
  const tx = await params.child.sendTransaction({
    to: params.tokenAddress,
    data,
    gasLimit: 120000n
  })
  const mined = await tx.wait()
  return mined?.hash ?? tx.hash
}

function toVaultAtomic(amount: bigint, decimals: number): string {
  if (decimals === 6) return amount.toString()
  if (decimals > 6) return (amount / 10n ** BigInt(decimals - 6)).toString()
  return (amount * 10n ** BigInt(6 - decimals)).toString()
}

async function recoverOne(chain: SupportedChain, tokenSymbol: TokenSymbol, derivationIndex: number, userId: string) {
  const token = CHAINS[chain].tokens[tokenSymbol]
  const provider = providerFor(chain)
  const child = demoEvmWallet(derivationIndex).connect(provider)
  const treasury = treasuryEvmWallet().connect(provider)
  const erc20 = new Contract(token.address, ERC20_ABI, provider)
  const bal = (await erc20.balanceOf(child.address)) as bigint
  if (bal <= 0n) return

  console.log(
    `[recover] ${chain} ${tokenSymbol} ${formatUnits(bal, token.decimals)} on ${child.address} -> ${treasuryEvmAddress()}`
  )
  const sweepTxHash = await transferToken({
    chain,
    tokenAddress: token.address,
    child,
    treasury,
    amount: bal
  })
  console.log(`[recover] sweep tx ${sweepTxHash}`)

  const key = `${chain}:${child.address.toLowerCase()}:${tokenSymbol}`
  const txHash = KNOWN_TX[key] ?? sweepTxHash
  if (findDepositByTx(chain, txHash)) {
    console.log(`[recover] deposit already recorded for ${txHash}`)
    return
  }

  const now = new Date().toISOString()
  let deposit = saveDeposit({
    id: uuidv4(),
    userId,
    chain,
    token: tokenSymbol,
    txHash,
    amountAtomic: toVaultAtomic(bal, token.decimals),
    amountUsdt: formatUnits(bal, token.decimals),
    status: 'confirmed',
    sweepTxHash,
    createdAt: now,
    updatedAt: now
  })
  deposit = await creditVaultOnAlephium(deposit)
  console.log(`[recover] credit status=${deposit.status} creditTxId=${deposit.creditTxId ?? ''} error=${deposit.error ?? ''}`)
}

async function main() {
  if (!hubMnemonic()) throw new Error('HUB_MNEMONIC missing')
  const rows = listAddresses().filter((a) => isDemoEvmAddress(a.address, a.derivationIndex))
  if (rows.length === 0) {
    console.log('[recover] no demo deposit addresses')
    return
  }
  console.log(`[recover] ${rows.length} demo address rows, treasury=${treasuryEvmAddress()}`)

  const chains = Object.keys(CHAINS) as SupportedChain[]
  const seen = new Set<string>()
  for (const row of rows) {
    for (const chain of chains) {
      for (const tokenSymbol of ['USDT', 'USDC'] as TokenSymbol[]) {
        const k = `${row.derivationIndex}:${chain}:${tokenSymbol}`
        if (seen.has(k)) continue
        seen.add(k)
        try {
          await recoverOne(chain, tokenSymbol, row.derivationIndex, row.userId)
        } catch (e: any) {
          console.error(`[recover] ${chain} ${tokenSymbol} idx=${row.derivationIndex} error:`, e?.message ?? e)
        }
      }
    }
  }

  const byUser = new Map<string, number>()
  for (const row of rows) {
    if (!byUser.has(row.userId)) byUser.set(row.userId, row.derivationIndex)
  }
  for (const [userId, derivationIndex] of byUser) {
    const address = deriveEvmDepositAddress(derivationIndex)
    unifyUserDepositAddress(userId, derivationIndex, address)
    console.log(`[recover] rotated user ${userId} idx=${derivationIndex} -> ${address}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
