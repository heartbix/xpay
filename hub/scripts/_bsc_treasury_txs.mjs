import { JsonRpcProvider, formatEther } from 'ethers'

const treasury = '0x6920B2701Ae542b5A4Ad00FB3c11b1fc61979490'
const p = new JsonRpcProvider('https://bsc-dataseed.binance.org', 56, { staticNetwork: true })
const n = await p.getTransactionCount(treasury)
console.log('bsc nonce', n)
const start = Math.max(0, n - 10)
for (let i = start; i < n; i++) {
  const tx = await p.getTransaction({ from: treasury, nonce: i }).catch(() => null)
  if (!tx) {
    console.log('missing', i)
    continue
  }
  const rec = await p.getTransactionReceipt(tx.hash)
  const fee = rec.fee ?? rec.gasUsed * (rec.gasPrice ?? 0n)
  console.log(
    JSON.stringify({
      nonce: i,
      hash: tx.hash,
      to: tx.to,
      value: tx.value.toString(),
      gasBNB: formatEther(fee),
      status: Number(rec.status)
    })
  )
}
