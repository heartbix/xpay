import { v4 as uuidv4 } from 'uuid'

export type OpsEvent = {
  id: string
  at: string
  kind: 'deposit' | 'x402' | 'payout' | 'gas' | 'sim'
  status: string
  title: string
  detail: string
  txId?: string
  chain?: string
  simulated?: boolean
  flowId?: string
}

let events: OpsEvent[] = []

export function listOpsEvents(): OpsEvent[] {
  return events
}

export function pushOpsEvent(row: Omit<OpsEvent, 'id' | 'at'> & { id?: string; at?: string }): OpsEvent {
  const next: OpsEvent = {
    id: row.id ?? uuidv4(),
    at: row.at ?? new Date().toISOString(),
    kind: row.kind,
    status: row.status,
    title: row.title,
    detail: row.detail,
    txId: row.txId,
    chain: row.chain,
    simulated: row.simulated,
    flowId: row.flowId
  }
  events = [next, ...events.filter((e) => e.id !== next.id)].slice(0, 80)
  return next
}

export function startSimulatedDeposit(): { flowId: string; txHash: string } {
  const flowId = uuidv4()
  const txHash = `0xsim${flowId.replace(/-/g, '').slice(0, 40)}`
  const base = {
    kind: 'deposit' as const,
    chain: 'base',
    txId: txHash,
    simulated: true,
    flowId
  }
  pushOpsEvent({
    ...base,
    status: 'detected',
    title: 'Deposit detected',
    detail: '0.50 USDT on Base → unique HD address'
  })
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'confirmed',
      title: 'Deposit confirmed',
      detail: 'Base inclusion confirmed. Preparing sweep to treasury.'
    })
  }, 5000)
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'sweeping',
      title: 'Sweeping to treasury',
      detail: 'USDT moving to hub treasury. Gas paid in ETH on Base.'
    })
  }, 10000)
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'credited',
      title: 'Ledger credited',
      detail: '0.50 USDT available. Sweep cost recouped on later withdraw. (Simulation — no ledger credit.)'
    })
  }, 15000)
  return { flowId, txHash }
}

export function startSimulatedX402(): { flowId: string; payUrl: string } {
  const flowId = uuidv4()
  const payTo = '16WB542zSmpVZqMfR7pUn2AXidkyiYFcxTmMX6T5HJpFk'
  const slug = 'monitor'
  const payUrl = `https://xpay.heartbix.com/api/pay/${payTo}/${slug}`
  const base = {
    kind: 'x402' as const,
    simulated: true,
    flowId
  }
  pushOpsEvent({
    ...base,
    status: 'seller_api',
    title: 'Seller creates endpoint',
    detail: 'POST /api/merchants with x-api-key · slug monitor · price 0.001 USDT'
  })
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'pay_url',
      title: 'Pay URL ready',
      detail: `Seller shares ${payUrl} (unique alph + slug). Optional ?price=0.05 with seller API key.`
    })
  }, 4000)
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'http_402',
      title: 'Buyer hits URL',
      detail: 'GET without payment → HTTP 402 + PAYMENT-REQUIRED (amount, payTo, vault).'
    })
  }, 8000)
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'signed',
      title: 'Buyer signs payment',
      detail: 'Wallet/agent signs PaymentVault hash, retries with PAYMENT-SIGNATURE header.'
    })
  }, 12000)
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'settling',
      title: 'On-chain settle',
      detail: 'Signature verified. PaymentVault.settle submitted; History Txid is the MUSDT transfer.',
      txId: `simx402${flowId.replace(/-/g, '').slice(0, 24)}`
    })
  }, 16000)
  setTimeout(() => {
    pushOpsEvent({
      ...base,
      status: 'recorded',
      title: 'X402 recorded',
      detail: 'Seller History: received. Buyer History: sent. (Simulation.)',
      txId: `simx402${flowId.replace(/-/g, '').slice(0, 24)}`
    })
  }, 20000)
  return { flowId, payUrl }
}
