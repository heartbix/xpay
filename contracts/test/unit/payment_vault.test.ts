import { web3, addressFromContractId, DUST_AMOUNT, ONE_ALPH, MINIMAL_CONTRACT_DEPOSIT } from '@alephium/web3'
import { expectAssertionError, randomContractId, testAddress } from '@alephium/web3-test'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { PaymentVault, PaymentVaultTypes } from '../../artifacts/ts'

describe('PaymentVault unit tests', () => {
  const depositAmount = 50n * 1_000_000n
  const payAmount = 10n * 1_000_000n
  let admin: string
  let hub: string
  let payer: PrivateKeyWallet
  let payee: string
  let testContractId: string
  let testContractAddress: string
  let usdtTokenId: string

  beforeAll(() => {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)
    admin = PrivateKeyWallet.Random(0).address
    hub = admin
    payer = PrivateKeyWallet.Random(0)
    payee = PrivateKeyWallet.Random(0).address
    testContractId = randomContractId()
    testContractAddress = addressFromContractId(testContractId)
    usdtTokenId = randomContractId()
  })

  const baseFields = () => ({
    admin,
    hub,
    usdtTokenId,
    paused: false
  })

  it('registers key and deposits MockUSDT', async () => {
    const register = await PaymentVault.tests.registerPublicKey({
      address: testContractAddress,
      initialAsset: { alphAmount: ONE_ALPH },
      initialFields: baseFields(),
      testArgs: { publicKey: payer.publicKey },
      inputAssets: [
        {
          address: payer.address,
          asset: { alphAmount: ONE_ALPH + MINIMAL_CONTRACT_DEPOSIT }
        }
      ]
    })

    expect(register.maps?.publicKeys?.get(payer.address)).toEqual(payer.publicKey)

    const deposit = await PaymentVault.tests.deposit({
      address: testContractAddress,
      initialAsset: { alphAmount: ONE_ALPH, tokens: [{ id: usdtTokenId, amount: 0n }] },
      initialFields: baseFields(),
      initialMaps: register.maps,
      testArgs: { amount: depositAmount },
      inputAssets: [
        {
          address: payer.address,
          asset: {
            alphAmount: ONE_ALPH + MINIMAL_CONTRACT_DEPOSIT * 2n,
            tokens: [{ id: usdtTokenId, amount: depositAmount }]
          }
        }
      ]
    })

    expect(deposit.maps?.balances?.get(payer.address)).toEqual(depositAmount)
    expect(deposit.maps?.nonces?.get(payer.address)).toEqual(0n)
    const event = deposit.events.find((e) => e.name === 'Deposited') as PaymentVaultTypes.DepositedEvent
    expect(event.fields.user).toEqual(payer.address)
    expect(event.fields.amount).toEqual(depositAmount)
  })

  it('settles a signed payment to payee', async () => {
    const nonce = 0n
    const deadline = BigInt(Date.now()) + 60_000n * 60n // ms-ish; contract uses blockTimeStamp in ms typically

    const maps: PaymentVaultTypes.Maps = {
      balances: new Map([[payer.address, depositAmount]]),
      nonces: new Map([[payer.address, nonce]]),
      publicKeys: new Map([[payer.address, payer.publicKey]])
    }

    const hashResult = await PaymentVault.tests.paymentHash({
      address: testContractAddress,
      initialAsset: { alphAmount: ONE_ALPH, tokens: [{ id: usdtTokenId, amount: depositAmount }] },
      initialFields: baseFields(),
      initialMaps: maps,
      testArgs: {
        from: payer.address,
        to: payee,
        amount: payAmount,
        nonce,
        deadline
      }
    })

    const signature = await payer.signRaw(payer.address, hashResult.returns)

    const settle = await PaymentVault.tests.settle({
      address: testContractAddress,
      initialAsset: { alphAmount: ONE_ALPH, tokens: [{ id: usdtTokenId, amount: depositAmount }] },
      initialFields: baseFields(),
      initialMaps: maps,
      testArgs: {
        from: payer.address,
        to: payee,
        amount: payAmount,
        nonce,
        deadline,
        signature
      },
      inputAssets: [{ address: testAddress, asset: { alphAmount: ONE_ALPH } }]
    })

    expect(settle.maps?.balances?.get(payer.address)).toEqual(depositAmount - payAmount)
    expect(settle.maps?.balances?.get(payee)).toEqual(payAmount)
    expect(settle.maps?.nonces?.get(payer.address)).toEqual(1n)

    const settled = settle.events.find((e) => e.name === 'Settled') as PaymentVaultTypes.SettledEvent
    expect(settled.fields.from).toEqual(payer.address)
    expect(settled.fields.to).toEqual(payee)
    expect(settled.fields.amount).toEqual(payAmount)
  })

  it('rejects expired payment', async () => {
    const maps: PaymentVaultTypes.Maps = {
      balances: new Map([[payer.address, depositAmount]]),
      nonces: new Map([[payer.address, 0n]]),
      publicKeys: new Map([[payer.address, payer.publicKey]])
    }

    await expectAssertionError(
      PaymentVault.tests.settle({
        address: testContractAddress,
        initialAsset: { alphAmount: ONE_ALPH, tokens: [{ id: usdtTokenId, amount: depositAmount }] },
        initialFields: baseFields(),
        initialMaps: maps,
        testArgs: {
          from: payer.address,
          to: payee,
          amount: payAmount,
          nonce: 0n,
          deadline: 1n,
          signature: '00'.repeat(64)
        },
        inputAssets: [{ address: testAddress, asset: { alphAmount: ONE_ALPH } }]
      }),
      testContractAddress,
      4
    )
  })
})
