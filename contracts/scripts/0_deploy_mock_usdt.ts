import { Deployer, DeployFunction, Network } from '@alephium/cli'
import { Settings } from '../alephium.config'
import { MockUSDT } from '../artifacts/ts'
import { stringToHex } from '@alephium/web3'

const deployMockUSDT: DeployFunction<Settings> = async (
  deployer: Deployer,
  network: Network<Settings>
): Promise<void> => {
  const issueTokenAmount = network.settings.issueTokenAmount
  const claimAmount = network.settings.claimAmount
  const result = await deployer.deployContract(MockUSDT, {
    issueTokenAmount,
    initialFields: {
      symbol: stringToHex('MUSDT'),
      name: stringToHex('MockUSDT'),
      decimals: 6n,
      supply: issueTokenAmount,
      balance: issueTokenAmount,
      claimAmount
    }
  })
  console.log('MockUSDT contract id: ' + result.contractInstance.contractId)
  console.log('MockUSDT contract address: ' + result.contractInstance.address)
  console.log('MockUSDT token id: ' + result.contractInstance.contractId)
}

export default deployMockUSDT
