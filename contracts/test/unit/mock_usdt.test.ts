import { web3, addressFromContractId, AssetOutput, DUST_AMOUNT } from '@alephium/web3'
import { expectAssertionError, randomContractId, testAddress } from '@alephium/web3-test'
import { MockUSDT, MockUSDTTypes } from '../../artifacts/ts'

describe('MockUSDT unit tests', () => {
  const claimAmount = 100n * 1_000_000n
  let testContractId: string
  let testTokenId: string
  let testContractAddress: string

  beforeAll(() => {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)
    testContractId = randomContractId()
    testTokenId = testContractId
    testContractAddress = addressFromContractId(testContractId)
  })

  it('claims fixed faucet amount', async () => {
    const result = await MockUSDT.tests.claim({
      address: testContractAddress,
      initialAsset: {
        alphAmount: 10n ** 18n,
        tokens: [{ id: testTokenId, amount: claimAmount * 10n }]
      },
      initialFields: {
        symbol: Buffer.from('MUSDT', 'utf8').toString('hex'),
        name: Buffer.from('MockUSDT', 'utf8').toString('hex'),
        decimals: 6n,
        supply: claimAmount * 10n,
        balance: claimAmount * 10n,
        claimAmount
      },
      inputAssets: [{ address: testAddress, asset: { alphAmount: 10n ** 18n } }]
    })

    const state = result.contracts[0] as MockUSDTTypes.State
    expect(state.fields.balance).toEqual(claimAmount * 9n)

    const tokenOutput = result.txOutputs[0] as AssetOutput
    expect(tokenOutput.address).toEqual(testAddress)
    expect(tokenOutput.alphAmount).toEqual(DUST_AMOUNT)
    expect(tokenOutput.tokens).toEqual([{ id: testTokenId, amount: claimAmount }])

    expect(result.events.length).toEqual(1)
    const event = result.events[0] as MockUSDTTypes.ClaimEvent
    expect(event.name).toEqual('Claim')
    expect(event.fields.to).toEqual(testAddress)
    expect(event.fields.amount).toEqual(claimAmount)
  })

  it('rejects claim when faucet empty', async () => {
    await expectAssertionError(
      MockUSDT.tests.claim({
        address: testContractAddress,
        initialAsset: { alphAmount: 10n ** 18n, tokens: [{ id: testTokenId, amount: 0n }] },
        initialFields: {
          symbol: Buffer.from('MUSDT', 'utf8').toString('hex'),
          name: Buffer.from('MockUSDT', 'utf8').toString('hex'),
          decimals: 6n,
          supply: claimAmount,
          balance: 0n,
          claimAmount
        },
        inputAssets: [{ address: testAddress, asset: { alphAmount: 10n ** 18n } }]
      }),
      testContractAddress,
      1
    )
  })
})
