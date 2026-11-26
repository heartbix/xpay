import { Contract } from 'ethers'
import { TokenSymbol, getToken } from './chains'
import { deriveEvmWallet, treasuryEvmAddress, treasuryEvmWallet } from './addresses'
import { withProvider } from './rpc'
import { receiptCostUsdtAtomic } from './tx-cost'
import { DepositRecord, listAddresses, listDeposits, saveDeposit } from './store'

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]

/**
 * Move deposited USDT/USDC from the user's HD address to the platform treasury.
 * Tops up native gas from the treasury account when needed.
 */
export async function sweepDepositToTreasury(
  deposit: DepositRecord,
  derivationIndex: number,
  tokenAmount: bigint
): Promise<DepositRecord> {
  if (process.env.HUB_AUTO_SWEEP !== '1') return deposit
  if (!process.env.HUB_MNEMONIC?.trim()) {
    deposit.sweepError = 'HUB_MNEMONIC missing'
    return saveDeposit(deposit)
  }
  if (tokenAmount <= 0n) return deposit

  const tokenSymbol = (deposit.token ?? 'USDT') as TokenSymbol
  const token = getToken(deposit.chain, tokenSymbol)
  const child = deriveEvmWallet(derivationIndex)
  const treasury = treasuryEvmWallet()
  const to = treasuryEvmAddress()
  const erc20 = new Contract(token.address, ERC20_ABI, child)

  try {
    // withProvider retries the whole sweep on the next RPC when the primary
    // is rate-limited. A sweep is idempotent: if the transfer already landed,
    // the retry sees a zero balance and exits without a second send.
    return await withProvider(deposit.chain, async (provider) => {
      const childSigner = child.connect(provider)
      const treasurySigner = treasury.connect(provider)
      const erc20On = new Contract(token.address, ERC20_ABI, childSigner)
      const fee = await provider.getFeeData()
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n
      const gasNeed = gasPrice * 80_000n
      const native = await provider.getBalance(childSigner.address)
      let cost = 0n
      if (native < gasNeed) {
        const topUp = gasNeed * 2n
        const treasuryBal = await provider.getBalance(treasurySigner.address)
        if (treasuryBal < topUp) {
          deposit.sweepError = `treasury_native_low need ${topUp.toString()} on ${deposit.chain}`
          return saveDeposit(deposit)
        }
        const gasTx = await treasurySigner.sendTransaction({ to: childSigner.address, value: topUp })
        const gasMined = await gasTx.wait()
        cost += BigInt(await receiptCostUsdtAtomic(deposit.chain, gasMined))
      }

      const tx = await erc20On.transfer(to, tokenAmount)
      const mined = await tx.wait()
      cost += BigInt(await receiptCostUsdtAtomic(deposit.chain, mined))
      deposit.sweepTxHash = mined?.hash ?? tx.hash
      deposit.costUsdtAtomic = cost.toString()
      deposit.sweepError = undefined
      deposit.updatedAt = new Date().toISOString()
      console.log(
        `[sweep] ${deposit.chain} ${tokenSymbol} ${tokenAmount.toString()} -> ${to} tx=${deposit.sweepTxHash}`
      )
      return saveDeposit(deposit)
    })
  } catch (e: any) {
    deposit.sweepError = e?.message ?? String(e)
    deposit.updatedAt = new Date().toISOString()
    console.error(`[sweep] ${deposit.chain} error:`, deposit.sweepError)
    return saveDeposit(deposit)
  }
}

/** Retry credited deposits that never reached treasury (e.g. treasury gas was empty). */
export async function retryUnsweptDeposits(): Promise<void> {
  if (process.env.HUB_AUTO_SWEEP !== '1') return
  const addrs = listAddresses()
  for (const deposit of listDeposits()) {
    if (deposit.status !== 'credited' || deposit.sweepTxHash) continue
    const owner = addrs.find(
      (a) => a.userId === deposit.userId && a.chain === deposit.chain
    )
    if (!owner) continue
    const tokenSymbol = (deposit.token ?? 'USDT') as TokenSymbol
    const token = getToken(deposit.chain, tokenSymbol)
    const live = await withProvider(deposit.chain, async (provider) => {
      const erc20 = new Contract(token.address, ERC20_ABI, provider)
      return (await erc20.balanceOf(owner.address)) as bigint
    })
    if (live <= 0n) continue
    await sweepDepositToTreasury(deposit, owner.derivationIndex, live)
  }
}
