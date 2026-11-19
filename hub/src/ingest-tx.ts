import { isSupportedChain } from './chains'
import { ingestTx } from './watcher'

const chain = String(process.argv[2] ?? '')
const txHash = String(process.argv[3] ?? '')
if (!isSupportedChain(chain) || !txHash.startsWith('0x')) {
  console.error('usage: node dist/ingest-tx.js <ethereum|bsc|polygon|arbitrum|base> <txHash>')
  process.exit(1)
}

ingestTx(chain, txHash)
  .then(() => {
    console.log(`ingested ${chain} ${txHash}`)
    process.exit(0)
  })
  .catch((e) => {
    console.error(e?.message ?? e)
    process.exit(1)
  })
