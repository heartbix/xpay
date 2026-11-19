import { Deployer, DeployFunction, Network } from '@alephium/cli'
import { Settings } from '../alephium.config'
import { PaymentVault } from '../artifacts/ts'
import { ONE_ALPH } from '@alephium/web3'

const deployPaymentVault: DeployFunction<Settings> = async (
  deployer: Deployer,
  network: Network<Settings>
): Promise<void> => {
  const mockUsdt = deployer.getDeployContractResult('MockUSDT')
  const admin = deployer.account.address
  // Until Phase 3 hub exists, admin acts as hub minter
  const hub = network.settings.hubAddress ?? admin

  const result = await deployer.deployContract(PaymentVault, {
    initialFields: {
      admin,
      hub,
      usdtTokenId: mockUsdt.contractInstance.contractId,
      paused: false
    },
    // Dust ALPH buffer for token outs on settle
    initialAttoAlphAmount: network.settings.vaultInitialAlph ?? ONE_ALPH
  })

  console.log('PaymentVault contract id: ' + result.contractInstance.contractId)
  console.log('PaymentVault contract address: ' + result.contractInstance.address)
  console.log('PaymentVault hub: ' + hub)
}

export default deployPaymentVault
