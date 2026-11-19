import { TransactionReceipt } from 'ethers'
import { SupportedChain } from './chains'
import { ceilUsdToUsdtAtomic } from './fees'
import { getNativeUsdPrice } from './price'
import { withProvider } from './rpc'

export async function receiptCostUsdtAtomic(
  chain: SupportedChain,
  receipt: TransactionReceipt | null | undefined
): Promise<string> {
  if (!receipt) return '0'
  const gasWei =
    receipt.fee ??
    receipt.gasUsed * (receipt.gasPrice ?? 0n)
  const extra = BigInt((receipt as { l1Fee?: bigint }).l1Fee ?? 0n)
  const usd = await getNativeUsdPrice(chain)
  return ceilUsdToUsdtAtomic((Number(gasWei + extra) / 1e18) * usd).toString()
}

export async function evmTxCostUsdtAtomic(chain: SupportedChain, txHash: string): Promise<string> {
  try {
    return await withProvider(chain, async (provider) => {
      const receipt = await provider.getTransactionReceipt(txHash)
      return receiptCostUsdtAtomic(chain, receipt)
    })
  } catch {
    return '0'
  }
}
