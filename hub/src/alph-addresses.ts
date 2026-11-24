import { PrivateKeyWallet, deriveHDWalletPrivateKeyForGroup } from '@alephium/web3-wallet'
import { readMnemonic } from './addresses'

/** Public test phrase — never used to assign live user addresses. */
const DEMO_MNEMONIC = 'test test test test test test test test test test test junk'
export const ALPH_RECEIVE_GROUP = 0
const DEMO_SCAN = 32

function alphMnemonic(): string {
  const m = readMnemonic('HUB_ALPH_MNEMONIC') || readMnemonic('HUB_MNEMONIC')
  if (!m) throw new Error('HUB_MNEMONIC missing')
  return m
}

export function isDemoAlphSeed(): boolean {
  return !readMnemonic('HUB_ALPH_MNEMONIC') && !readMnemonic('HUB_MNEMONIC')
}

function walletFrom(mnemonic: string, fromIndex: number): { wallet: PrivateKeyWallet; derivationIndex: number } {
  const [privateKey, derivationIndex] = deriveHDWalletPrivateKeyForGroup(
    mnemonic,
    ALPH_RECEIVE_GROUP,
    'default',
    fromIndex
  )
  return { wallet: new PrivateKeyWallet({ privateKey }), derivationIndex }
}

export function isDemoAlphAddress(address: string): boolean {
  for (let i = 0; i < DEMO_SCAN; i++) {
    const { wallet } = walletFrom(DEMO_MNEMONIC, i)
    if (wallet.address === address) return true
  }
  return false
}

/** Sign for a leftover demo-phrase address during one-time migration. */
export function demoAlphWalletFor(address: string): PrivateKeyWallet | undefined {
  for (let i = 0; i < DEMO_SCAN; i++) {
    const { wallet } = walletFrom(DEMO_MNEMONIC, i)
    if (wallet.address === address) return wallet
  }
  return undefined
}

/** Unique group-0 Alephium address from the hub HD seed, starting at fromIndex. */
export function allocateGroup0Address(fromIndex: number): { address: string; derivationIndex: number } {
  const { wallet, derivationIndex } = walletFrom(alphMnemonic(), fromIndex)
  return { address: wallet.address, derivationIndex }
}
