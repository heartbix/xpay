import { HDNodeWallet, Wallet } from 'ethers'
import { SupportedChain } from './chains'

const DEMO_MNEMONIC = 'test test test test test test test test test test test junk'

export const EVM_DEPOSIT_PATH = (index: number) => `m/44'/60'/0'/0/${index}`
/** Change-account path so the treasury is never a user deposit address. */
export const EVM_TREASURY_PATH = "m/44'/60'/0'/1/0"

/**
 * Reads a mnemonic from the environment, stripping surrounding quotes.
 * `.env` files commonly wrap values in quotes (`HUB_MNEMONIC="word word ..."`),
 * and a literal quote in the phrase silently derives different addresses.
 */
export function readMnemonic(name: 'HUB_MNEMONIC' | 'HUB_ALPH_MNEMONIC'): string | undefined {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  const unquoted = raw.replace(/^(['"])(.*)\1$/s, '$2').trim()
  return unquoted || undefined
}

export function hubMnemonic(): string | undefined {
  return readMnemonic('HUB_MNEMONIC')
}

export function deriveEvmWallet(index: number): HDNodeWallet {
  const mnemonic = hubMnemonic()
  if (!mnemonic) throw new Error('HUB_MNEMONIC missing')
  return HDNodeWallet.fromPhrase(mnemonic, undefined, EVM_DEPOSIT_PATH(index))
}

export function treasuryEvmWallet(): HDNodeWallet {
  const mnemonic = hubMnemonic()
  if (!mnemonic) throw new Error('HUB_MNEMONIC missing')
  return HDNodeWallet.fromPhrase(mnemonic, undefined, EVM_TREASURY_PATH)
}

export function treasuryEvmAddress(): string {
  const override = process.env.HUB_TREASURY_ADDRESS?.trim()
  if (override) return override
  return treasuryEvmWallet().address
}

/** EVM deposit address for a derivation index (shared across ETH/BSC/Polygon/Arbitrum). */
export function deriveEvmDepositAddress(index: number): string {
  const mnemonic = hubMnemonic()
  if (mnemonic) {
    return HDNodeWallet.fromPhrase(mnemonic, undefined, EVM_DEPOSIT_PATH(index)).address
  }

  const privateKey = process.env.HUB_PRIVATE_KEY?.trim()
  if (privateKey) {
    if (index !== 0) {
      throw new Error('HUB_PRIVATE_KEY mode only supports index 0 (one shared deposit address)')
    }
    return new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`).address
  }

  throw new Error('HUB_MNEMONIC missing')
}

export function deriveDepositAddress(chain: SupportedChain, index: number): string {
  void chain
  return deriveEvmDepositAddress(index)
}

export function isDemoSeed(): boolean {
  return !hubMnemonic() && !process.env.HUB_PRIVATE_KEY
}

export function demoEvmWallet(index: number): HDNodeWallet {
  return HDNodeWallet.fromPhrase(DEMO_MNEMONIC, undefined, EVM_DEPOSIT_PATH(index))
}

export function isDemoEvmAddress(address: string, index: number): boolean {
  return demoEvmWallet(index).address.toLowerCase() === address.toLowerCase()
}
