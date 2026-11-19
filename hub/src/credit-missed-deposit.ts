import { v4 as uuidv4 } from 'uuid'
import { creditVaultOnAlephium } from './credit'
import { findDepositByTx, saveDeposit } from './store'

const TX = '0x5ab57ce3bbdd5326abd44625975456cbc140371139cdbd3b6ee056591036f330'
const USER = 'e16a2da2-70a4-47f4-820b-733785054c33'

async function main() {
  const existing = findDepositByTx('arbitrum', TX)
  if (existing?.status === 'credited') {
    console.log('already credited', existing.creditTxId)
    return
  }
  const now = new Date().toISOString()
  let deposit = existing ?? saveDeposit({
    id: uuidv4(),
    userId: USER,
    chain: 'arbitrum',
    token: 'USDC',
    txHash: TX,
    amountAtomic: '800000',
    amountUsdt: '0.8',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now
  })
  deposit = await creditVaultOnAlephium(deposit)
  console.log(
    `status=${deposit.status} creditTxId=${deposit.creditTxId ?? ''} error=${deposit.error ?? ''} net=${deposit.netAtomic ?? ''}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
