import { v4 as uuidv4 } from 'uuid'
import { runBourmattPaysAdmin } from './x402-live-test'

runBourmattPaysAdmin(uuidv4())
  .then((r) => {
    console.log(JSON.stringify({ step: 'done', payUrl: r.payUrl, txId: r.txId ?? null }))
  })
  .catch((e) => {
    console.error(JSON.stringify({ step: 'error', message: e?.message ?? String(e) }))
    process.exit(1)
  })
