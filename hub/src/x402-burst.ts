import { v4 as uuidv4 } from 'uuid'
import { runX402Burst } from './x402-live-test'

runX402Burst(uuidv4())
  .then((r) => {
    const times = r.pays.map((p) => p.ms)
    const min = Math.min(...times)
    const max = Math.max(...times)
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    console.log(
      JSON.stringify(
        {
          step: 'done',
          payUrl: r.payUrl,
          count: r.pays.length,
          totalMs: r.totalMs,
          totalAtomic: r.totalAtomic,
          minMs: min,
          maxMs: max,
          avgMs: avg,
          first: r.pays[0],
          last: r.pays[r.pays.length - 1]
        },
        null,
        2
      )
    )
  })
  .catch((e) => {
    console.error(JSON.stringify({ step: 'error', message: e?.message ?? String(e) }))
    process.exit(1)
  })
