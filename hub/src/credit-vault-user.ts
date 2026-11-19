/**
 * Credit PaymentVault for a user without adding a Fund deposit row.
 */
import { DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, web3 } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { PaymentVault } from 'my-contracts'
import { getUser } from './store'

async function main() {
  const userId = process.env.CREDIT_USER_ID?.trim()
  const amount = BigInt(process.env.CREDIT_AMOUNT_ATOMIC || '0')
  if (!userId || amount <= 0n) throw new Error('CREDIT_USER_ID and CREDIT_AMOUNT_ATOMIC required')
  const user = getUser(userId)
  if (!user?.alphAddress) throw new Error('user missing alph address')

  const privateKey = process.env.HUB_ALPH_PRIVATE_KEY?.trim()
  if (!privateKey) throw new Error('HUB_ALPH_PRIVATE_KEY missing')
  web3.setCurrentNodeProvider(process.env.ALEPHIUM_NODE_URL ?? 'https://node.testnet.alephium.org')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadDeployments } = require('my-contracts/deployments') as {
    loadDeployments: (network: 'devnet' | 'testnet' | 'mainnet') => {
      contracts: {
        PaymentVault: { contractInstance: { address: string } }
        MockUSDT: { contractInstance: { contractId: string } }
      }
    }
  }
  const network = (process.env.ALEPHIUM_NETWORK ?? 'testnet') as 'devnet' | 'testnet' | 'mainnet'
  const deployments = loadDeployments(network)
  const vault = PaymentVault.at(deployments.contracts.PaymentVault.contractInstance.address)
  const usdtId = deployments.contracts.MockUSDT.contractInstance.contractId
  const signer = new PrivateKeyWallet({ privateKey, nodeProvider: web3.getCurrentNodeProvider() })
  const before = (await vault.view.getBalance({ args: { user: user.alphAddress } })).returns
  const result = await vault.transact.creditFromHub({
    signer,
    args: { user: user.alphAddress, amount },
    attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 2n + DUST_AMOUNT,
    tokens: [{ id: usdtId, amount }]
  })
  console.log(
    JSON.stringify({
      email: user.email ?? null,
      alphAddress: user.alphAddress,
      amount: amount.toString(),
      before: before.toString(),
      txId: result.txId
    })
  )
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e?.message ?? String(e) }))
  process.exit(1)
})
