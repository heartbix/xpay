import { waitVaultNonce, settlePaymentOnChain } from './alph-x402'
import { pushOpsEvent } from './ops-events'
import {
  completeX402ChainJob,
  failX402ChainReceipt,
  listX402ChainJobs,
  noteX402ChainJobError,
  saveX402SubmittedTx,
  X402ChainJob
} from './store'

const MAX_ATTEMPTS = 40
const MAX_PARALLEL = 6

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

let running = false
const inFlight = new Set<string>()

export function startX402ChainQueue() {
  if (running) return
  running = true
  void loop()
}

function pickJobs(limit: number): X402ChainJob[] {
  const busyFrom = new Set<string>()
  const queued = listX402ChainJobs()
  for (const job of queued) {
    if (inFlight.has(job.id)) busyFrom.add(job.from)
  }
  const picked: X402ChainJob[] = []
  for (const job of queued) {
    if (inFlight.has(job.id) || busyFrom.has(job.from)) continue
    busyFrom.add(job.from)
    picked.push(job)
    if (picked.length >= limit) break
  }
  return picked
}

async function loop() {
  while (running) {
    const slots = MAX_PARALLEL - inFlight.size
    if (slots <= 0) {
      await sleep(200)
      continue
    }
    const jobs = pickJobs(slots)
    if (jobs.length === 0) {
      await sleep(400)
      continue
    }
    for (const job of jobs) {
      inFlight.add(job.id)
      void runJob(job).finally(() => inFlight.delete(job.id))
    }
  }
}

async function runJob(job: X402ChainJob): Promise<void> {
  try {
    if (BigInt(job.deadline) < BigInt(Date.now()) && !job.submittedTxId) {
      throw new Error('expired')
    }
    let txId = job.submittedTxId
    if (!txId) {
      const chain = await settlePaymentOnChain({
        from: job.from,
        to: job.to,
        amount: BigInt(job.amount),
        nonce: BigInt(job.nonce),
        deadline: BigInt(job.deadline),
        signature: job.signature
      })
      txId = chain.txId
    }
    saveX402SubmittedTx(job.id, job.pendingTxId, txId)
    pushOpsEvent({
      kind: 'x402',
      status: 'settled',
      title: 'MUSDT transfer',
      detail: `nonce ${job.nonce} · ${job.amount} atomic`,
      txId
    })
    await waitVaultNonce(job.from, BigInt(job.nonce) + 1n)
    completeX402ChainJob(job.id)
  } catch (e: any) {
    const code = e?.message ?? String(e)
    const queued = listX402ChainJobs().find((j) => j.id === job.id)
    if (queued?.submittedTxId) {
      completeX402ChainJob(job.id)
      return
    }
    const attempts = noteX402ChainJobError(job.id, code)
    const retry =
      attempts < MAX_ATTEMPTS && (code === 'script_execution_failed' || code === 'tx_not_confirmed')
    if (retry) {
      await sleep(2000)
      return runJob({ ...job, ...listX402ChainJobs().find((j) => j.id === job.id) })
    }
    failX402ChainReceipt(queued || job, code)
    pushOpsEvent({
      kind: 'x402',
      status: 'failed',
      title: 'MUSDT settle failed',
      detail: code,
      txId: job.pendingTxId
    })
    completeX402ChainJob(job.id)
  }
}
