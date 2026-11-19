import { Configuration } from '@alephium/cli'
import { Number256, ONE_ALPH, DUST_AMOUNT } from '@alephium/web3'

export type Settings = {
  issueTokenAmount: Number256
  claimAmount: Number256
  usdtFee: Number256
  dustTopUp: Number256
  sponsorInitialAlph: Number256
  vaultInitialAlph: Number256
  hubAddress?: string
  /** GasSponsor admin (withdraw / pause). Defaults to the deployer account. */
  sponsorAdmin?: string
}

// 1_000_000 MUSDT with 6 decimals => 1e12 base units; claim 100 MUSDT => 100e6
const defaultSettings: Settings = {
  issueTokenAmount: 1_000_000n * 1_000_000n,
  claimAmount: 100n * 1_000_000n,
  usdtFee: 100_000n, // 0.1 MUSDT
  dustTopUp: DUST_AMOUNT,
  sponsorInitialAlph: 10n * ONE_ALPH,
  vaultInitialAlph: ONE_ALPH
}

const configuration: Configuration<Settings> = {
  // Public testnet/mainnet nodes reject compile; artifacts from a prior compile are used.
  skipRecompile: true,
  networks: {
    devnet: {
      nodeUrl: 'http://127.0.0.1:22973',
      privateKeys: [
        'a642942e67258589cd2b1822c631506632db5a12aabcf413604e785300d762a5' // group 0
      ],
      settings: defaultSettings
    },

    testnet: {
      nodeUrl: (process.env.NODE_URL as string) ?? 'https://node.testnet.alephium.org',
      privateKeys: process.env.PRIVATE_KEYS === undefined ? [] : process.env.PRIVATE_KEYS.split(','),
      settings: {
        ...defaultSettings,
        sponsorInitialAlph: ONE_ALPH / 5n,
        vaultInitialAlph: ONE_ALPH / 5n,
        sponsorAdmin: '18ZCZGLj1ydsmFpBaP3NXWrHXvHa2SRb5WE2PAv2bzkM5'
      }
    },

    mainnet: {
      nodeUrl: (process.env.NODE_URL as string) ?? 'https://node.mainnet.alephium.org',
      privateKeys: process.env.PRIVATE_KEYS === undefined ? [] : process.env.PRIVATE_KEYS.split(','),
      settings: defaultSettings
    }
  }
}

export default configuration
