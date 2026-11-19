import { web3, addressFromContractId, DUST_AMOUNT, ONE_ALPH } from '@alephium/web3'
import { expectAssertionError, randomContractId, testAddress } from '@alephium/web3-test'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { GasSponsor, GasSponsorTypes } from '../../artifacts/ts'

describe('GasSponsor unit tests', () => {
  const usdtFee = 100_000n
  let admin: string
  let testContractId: string
  let testContractAddress: string
  let usdtTokenId: string

  beforeAll(() => {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)
    // Fresh wallet so admin !== testAddress (unauthorized caller)
    admin = PrivateKeyWallet.Random(0).address
    expect(admin).not.toEqual(testAddress)
    testContractId = randomContractId()
    testContractAddress = addressFromContractId(testContractId)
    usdtTokenId = randomContractId()
  })

  it('collects USDT fee, pays gas, and tops up dust', async () => {
    const result = await GasSponsor.tests.sponsoredPing({
      address: testContractAddress,
      initialAsset: {
        alphAmount: 5n * ONE_ALPH,
        tokens: []
      },
      initialFields: {
        admin,
        usdtTokenId,
        paused: false,
        usdtFee,
        dustTopUp: DUST_AMOUNT
      },
      inputAssets: [
        {
          address: testAddress,
          asset: {
            alphAmount: ONE_ALPH,
            tokens: [{ id: usdtTokenId, amount: usdtFee }]
          }
        }
      ]
    })

    const state = result.contracts[0] as GasSponsorTypes.State
    expect(state.asset.tokens).toEqual([{ id: usdtTokenId, amount: usdtFee }])

    const event = result.events.find((e) => e.name === 'Sponsored') as GasSponsorTypes.SponsoredEvent
    expect(event.fields.caller).toEqual(testAddress)
    expect(event.fields.usdtFeePaid).toEqual(usdtFee)
    expect(event.fields.dustSent).toEqual(DUST_AMOUNT)
  })

  it('rejects when paused', async () => {
    await expectAssertionError(
      GasSponsor.tests.sponsoredPing({
        address: testContractAddress,
        initialAsset: { alphAmount: 5n * ONE_ALPH },
        initialFields: {
          admin,
          usdtTokenId,
          paused: true,
          usdtFee,
          dustTopUp: DUST_AMOUNT
        },
        inputAssets: [
          {
            address: testAddress,
            asset: {
              alphAmount: ONE_ALPH,
              tokens: [{ id: usdtTokenId, amount: usdtFee }]
            }
          }
        ]
      }),
      testContractAddress,
      1
    )
  })

  it('only admin can pause', async () => {
    await expectAssertionError(
      GasSponsor.tests.setPaused({
        address: testContractAddress,
        initialAsset: { alphAmount: ONE_ALPH },
        initialFields: {
          admin,
          usdtTokenId,
          paused: false,
          usdtFee,
          dustTopUp: DUST_AMOUNT
        },
        testArgs: { value: true },
        inputAssets: [{ address: testAddress, asset: { alphAmount: ONE_ALPH } }]
      }),
      testContractAddress,
      0
    )
  })
})
