import { Deployer, DeployFunction, Network } from '@alephium/cli'
import { Settings } from '../alephium.config'
import { GasSponsor } from '../artifacts/ts'

const deployGasSponsor: DeployFunction<Settings> = async (
  deployer: Deployer,
  network: Network<Settings>
): Promise<void> => {
  const mockUsdt = deployer.getDeployContractResult('MockUSDT')
  const admin = network.settings.sponsorAdmin ?? deployer.account.address
  const initialAlph = network.settings.sponsorInitialAlph

  const result = await deployer.deployContract(GasSponsor, {
    initialFields: {
      admin,
      usdtTokenId: mockUsdt.contractInstance.contractId,
      paused: false,
      usdtFee: network.settings.usdtFee,
      dustTopUp: network.settings.dustTopUp
    },
    initialAttoAlphAmount: initialAlph
  })

  console.log('GasSponsor contract id: ' + result.contractInstance.contractId)
  console.log('GasSponsor contract address: ' + result.contractInstance.address)
  console.log('GasSponsor admin: ' + admin)
  console.log('GasSponsor USDT token id: ' + mockUsdt.contractInstance.contractId)
  console.log('GasSponsor initial ALPH: ' + initialAlph.toString())
}

export default deployGasSponsor
