import { payoutsEnabled } from './payout-guard'
import { executePayout } from './payouts'
import { peekScheduledPayout, savePayout } from './store'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_ATTEMPTS = 40

let running = false
const attempts = new Map<string, number>()

export function startPayoutQueue() {
  if (running) return
  running = true
  void loop()
}

async function loop() {
  while (running) {
    const row = peekScheduledPayout()
    if (!row) {
      await sleep(2000)
      continue
    }
    if (!payoutsEnabled()) {
      row.status = 'failed'
      row.error = 'payouts_locked'
      row.updatedAt = new Date().toISOString()
      savePayout(row)
      attempts.delete(row.id)
      continue
    }
    const n = (attempts.get(row.id) ?? 0) + 1
    attempts.set(row.id, n)
    const out = await executePayout(row)
    if (out.status === 'scheduled') {
      if (n >= MAX_ATTEMPTS) {
        out.status = 'failed'
        out.error = out.error || 'treasury_usdt_short'
        out.updatedAt = new Date().toISOString()
        savePayout(out)
        attempts.delete(row.id)
      } else {
        await sleep(15_000)
      }
      continue
    }
    attempts.delete(row.id)
    await sleep(500)
  }
}
