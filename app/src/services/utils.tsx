import { NetworkId } from '@alephium/web3'

export interface RailConfig {
  network: NetworkId
  groupIndex: number
  mockUsdtAddress: string
  mockUsdtTokenId: string
  gasSponsorAddress: string
  gasSponsorContractId: string
  paymentVaultAddress: string
  paymentVaultContractId: string
  usdtFee: bigint
  deploymentsReady: boolean
}

function getNetwork(): NetworkId {
  // Server-side code must follow the hub's network; client bundles only see the
  // inlined NEXT_PUBLIC_* value. Default to testnet so a missing var can never
  // silently point the app at devnet contracts that don't exist on the node.
  return (process.env.ALEPHIUM_NETWORK ??
    process.env.NEXT_PUBLIC_NETWORK ??
    'testnet') as NetworkId
}

function placeholderConfig(network: NetworkId): RailConfig {
  return {
    network,
    groupIndex: 0,
    mockUsdtAddress: 'undeployed',
    mockUsdtTokenId: '0'.repeat(64),
    gasSponsorAddress: 'undeployed',
    gasSponsorContractId: '0'.repeat(64),
    paymentVaultAddress: 'undeployed',
    paymentVaultContractId: '0'.repeat(64),
    usdtFee: BigInt(process.env.NEXT_PUBLIC_USDT_FEE ?? '100000'),
    deploymentsReady: false
  }
}

function getRailConfig(): RailConfig {
  const network = getNetwork()
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadDeployments } = require('my-contracts/deployments') as typeof import('my-contracts/deployments')
    const deployments = loadDeployments(network)
    const mockUsdt = deployments.contracts.MockUSDT.contractInstance
    const gasSponsor = deployments.contracts.GasSponsor.contractInstance
    const paymentVault = deployments.contracts.PaymentVault.contractInstance
    return {
      network,
      groupIndex: mockUsdt.groupIndex,
      mockUsdtAddress: mockUsdt.address,
      mockUsdtTokenId: mockUsdt.contractId,
      gasSponsorAddress: gasSponsor.address,
      gasSponsorContractId: gasSponsor.contractId,
      paymentVaultAddress: paymentVault.address,
      paymentVaultContractId: paymentVault.contractId,
      usdtFee: BigInt(process.env.NEXT_PUBLIC_USDT_FEE ?? '100000'),
      deploymentsReady: true
    }
  } catch {
    return placeholderConfig(network)
  }
}

export const railConfig = getRailConfig()
