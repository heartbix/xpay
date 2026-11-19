import { runVolumeFill } from './x402-live-test'

function summarize(label: string, r: Awaited<ReturnType<typeof runVolumeFill>>['adminToBourmatt']) {
  const times = r.pays.map((p) => p.ms)
  const prices = r.pays.map((p) => Number(p.amountUsdt))
  return {
    label,
    count: r.pays.length,
    totalMs: r.totalMs,
    totalAtomic: r.totalAtomic,
    minUsdt: Math.min(...prices),
    maxUsdt: Math.max(...prices),
    avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    first: r.pays[0],
    last: r.pays[r.pays.length - 1]
  }
}

const count = Number(process.env.X402_BURST_COUNT ?? '100')
runVolumeFill(Number.isFinite(count) && count > 0 ? Math.floor(count) : 100)
  .then((r) => {
    console.log(
      JSON.stringify(
        {
          step: 'done',
          adminToBourmatt: summarize('admin → bourmatt', r.adminToBourmatt),
          bourmattToAdmin: summarize('bourmatt → admin', r.bourmattToAdmin)
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
