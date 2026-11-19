import { NodeProvider, web3 } from '@alephium/web3'
import { PaymentVault, PaymentVaultInstance } from 'my-contracts'
import { loadDeployments } from 'my-contracts/deployments'
import { railConfig } from '@/services/utils'

export function getNodeProvider(): NodeProvider {
  const url =
    process.env.ALEPHIUM_NODE_URL ??
    (railConfig.network === 'devnet'
      ? 'http://127.0.0.1:22973'
      : railConfig.network === 'testnet'
        ? 'https://node.testnet.alephium.org'
        : 'https://node.mainnet.alephium.org')
  web3.setCurrentNodeProvider(url)
  return web3.getCurrentNodeProvider()
}

export function getPaymentVault(): PaymentVaultInstance {
  getNodeProvider()
  const deployments = loadDeployments(railConfig.network)
  return deployments.contracts.PaymentVault.contractInstance
}

export async function readVaultPaymentState(from: string) {
  const vault = getPaymentVault()
  const [balance, nonce, hasKey] = await Promise.all([
    vault.view.getBalance({ args: { user: from } }),
    vault.view.getNonce({ args: { user: from } }),
    vault.view.hasPublicKey({ args: { user: from } })
  ])
  return {
    vault,
    balance: balance.returns,
    nonce: nonce.returns,
    hasPublicKey: hasKey.returns
  }
}

export async function computePaymentHash(args: {
  from: string
  to: string
  amount: bigint
  nonce: bigint
  deadline: bigint
}) {
  const vault = getPaymentVault()
  const result = await vault.view.paymentHash({ args })
  return result.returns
}

export { PaymentVault }
