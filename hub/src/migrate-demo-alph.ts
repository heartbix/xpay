/**
 * One-shot: move PaymentVault balances off leftover demo-phrase Alephium
 * addresses onto real hub HD group-0 addresses. Does not print keys.
 */
import { DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { PaymentVault, SettlePayment } from 'my-contracts'
import { allocateGroup0Address, demoAlphWalletFor, isDemoAlphAddress } from './alph-addresses'
import { assignUserAlphAddress, getNextAlphIndex, listUsers } from './store'

function nodeUrl(): string {
  return (
    process.env.ALEPHIUM_NODE_URL ??
    (process.env.ALEPHIUM_NETWORK === 'mainnet'
      ? 'https://node.mainnet.alephium.org'
      : 'https://node.testnet.alephium.org')
  )
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitTx(txId: string) {
  const node = web3.getCurrentNodeProvider()
  for (let i = 0; i < 60; i++) {
    try {
      const tx = await node.transactions.getTransactionsStatus({ txId })
      if ((tx as { type?: string }).type === 'Confirmed') {
        await sleep(2000)
        return
      }
    } catch {
      /* not yet indexed */
    }
    await sleep(2000)
  }
  throw new Error(`tx not confirmed: ${txId}`)
}

async function main() {
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  web3.setCurrentNodeProvider(nodeUrl())
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: {
        PaymentVault: { contractInstance: { address: string } }
        MockUSDT: { contractInstance: { contractId: string } }
      }
    }
  }
  const deployments = loadDeployments(network)
  const vault = PaymentVault.at(deployments.contracts.PaymentVault.contractInstance.address)
  const usdtId = deployments.contracts.MockUSDT.contractInstance.contractId

  const hubKey = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!hubKey) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  const hubWallet = new PrivateKeyWallet({
    privateKey: hubKey,
    nodeProvider: web3.getCurrentNodeProvider()
  })

  const demoUsers = listUsers().filter((u) => u.alphAddress && isDemoAlphAddress(u.alphAddress))
  console.log(JSON.stringify({ step: 'scan', count: demoUsers.length }))

  for (const user of demoUsers) {
    const oldAddress = user.alphAddress!
    const demoWallet = demoAlphWalletFor(oldAddress)
    if (!demoWallet) throw new Error(`no demo key for ${oldAddress}`)

    const vaultBal = (await vault.view.getBalance({ args: { user: oldAddress } })).returns
    const nonce = (await vault.view.getNonce({ args: { user: oldAddress } })).returns
    const hasKey = (await vault.view.hasPublicKey({ args: { user: oldAddress } })).returns
    console.log(
      JSON.stringify({
        step: 'user',
        userId: user.userId,
        email: user.email ?? null,
        oldAddress,
        vaultBalance: vaultBal.toString(),
        nonce: nonce.toString(),
        hasPublicKey: hasKey
      })
    )

    if (vaultBal > 0n) {
      if (!hasKey) throw new Error(`public key missing on ${oldAddress}; cannot migrate vault`)
      const deadline = BigInt(Date.now()) + 600_000n
      const hash = (
        await vault.view.paymentHash({
          args: {
            from: oldAddress,
            to: hubWallet.address,
            amount: vaultBal,
            nonce,
            deadline
          }
        })
      ).returns
      const signature = await demoWallet.signRaw(oldAddress, hash)
      const settled = await SettlePayment.execute(hubWallet, {
        initialFields: {
          vault: vault.contractId,
          from: oldAddress,
          to: hubWallet.address,
          amount: vaultBal,
          nonce,
          deadline,
          signature
        },
        attoAlphAmount: DUST_AMOUNT * 2n
      })
      console.log(JSON.stringify({ step: 'settle_to_hub', txId: settled.txId }))
      await waitTx(settled.txId)
      const node = web3.getCurrentNodeProvider()
      for (let i = 0; i < 90; i++) {
        const utxoRes = await node.addresses.getAddressesAddressUtxos(hubWallet.address)
        const now = Date.now()
        const spendable = (utxoRes.utxos ?? []).reduce((sum, u) => {
          const lock = BigInt(u.lockTime ?? 0)
          if (lock > BigInt(now)) return sum
          const tokens = (u as { tokens?: { id: string; amount: string }[] }).tokens ?? []
          for (const t of tokens) {
            if (t.id === usdtId) sum += BigInt(t.amount)
          }
          return sum
        }, 0n)
        console.log(JSON.stringify({ step: 'hub_token_wait', spendable: spendable.toString() }))
        if (spendable >= vaultBal) break
        await sleep(4000)
      }
    }

    const allocated = allocateGroup0Address(getNextAlphIndex())
    if (vaultBal > 0n) {
      const credited = await vault.transact.creditFromHub({
        signer: hubWallet,
        args: { user: allocated.address, amount: vaultBal },
        attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 2n + DUST_AMOUNT,
        tokens: [{ id: usdtId, amount: vaultBal }]
      })
      console.log(JSON.stringify({ step: 'credit_new', txId: credited.txId, newAddress: allocated.address }))
      await waitTx(credited.txId)
    }

    const { user: next } = assignUserAlphAddress(user.userId, allocated.address, allocated.derivationIndex)
    console.log(
      JSON.stringify({
        step: 'reassigned',
        userId: user.userId,
        newAddress: next.alphAddress,
        derivationIndex: next.alphDerivationIndex
      })
    )
  }

  const leftover = listUsers().filter((u) => u.alphAddress && isDemoAlphAddress(u.alphAddress))
  console.log(JSON.stringify({ step: 'done', leftover: leftover.length }))
  if (leftover.length) process.exit(1)
}

main().catch((e) => {
  console.error(JSON.stringify({ step: 'error', message: e?.message ?? String(e) }))
  process.exit(1)
})
