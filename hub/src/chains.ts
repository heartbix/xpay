export type SupportedChain = 'ethereum' | 'bsc' | 'polygon' | 'arbitrum' | 'base'
export type TokenSymbol = 'USDT' | 'USDC'

export type TokenConfig = {
  symbol: TokenSymbol
  address: string
  decimals: number
}

export type ChainConfig = {
  id: SupportedChain
  name: string
  chainId: number
  tokens: Record<TokenSymbol, TokenConfig>
  explorerTx: (hash: string) => string
  rpcEnv: string
  defaultRpc?: string
  rpcFallbacks?: string[]
}

function token(symbol: TokenSymbol, address: string, decimals: number): TokenConfig {
  return { symbol, address, decimals }
}

export const CHAINS: Record<SupportedChain, ChainConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    tokens: {
      USDT: token('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6),
      USDC: token('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6)
    },
    explorerTx: (hash) => `https://etherscan.io/tx/${hash}`,
    rpcEnv: 'ETH_RPC_URL',
    defaultRpc: 'https://eth.llamarpc.com',
    rpcFallbacks: ['https://eth.drpc.org', 'https://rpc.flashbots.net', 'https://ethereum-rpc.publicnode.com']
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Smart Chain',
    chainId: 56,
    tokens: {
      USDT: token('USDT', '0x55d398326f99059fF775485246999027B3197955', 18),
      USDC: token('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18)
    },
    explorerTx: (hash) => `https://bscscan.com/tx/${hash}`,
    rpcEnv: 'BSC_RPC_URL',
    defaultRpc: 'https://bsc-dataseed.binance.org',
    rpcFallbacks: ['https://bsc-dataseed1.binance.org', 'https://bsc.publicnode.com']
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    tokens: {
      USDT: token('USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6),
      USDC: token('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6)
    },
    explorerTx: (hash) => `https://polygonscan.com/tx/${hash}`,
    rpcEnv: 'POLYGON_RPC_URL',
    defaultRpc: 'https://polygon.llamarpc.com',
    rpcFallbacks: ['https://polygon.drpc.org', 'https://polygon-bor-rpc.publicnode.com']
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    tokens: {
      USDT: token('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6),
      USDC: token('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6)
    },
    explorerTx: (hash) => `https://arbiscan.io/tx/${hash}`,
    rpcEnv: 'ARB_RPC_URL',
    defaultRpc: 'https://arb1.arbitrum.io/rpc',
    rpcFallbacks: ['https://arbitrum.drpc.org', 'https://arbitrum-one.publicnode.com']
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    tokens: {
      USDT: token('USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6),
      USDC: token('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6)
    },
    explorerTx: (hash) => `https://basescan.org/tx/${hash}`,
    rpcEnv: 'BASE_RPC_URL',
    defaultRpc: 'https://mainnet.base.org',
    rpcFallbacks: ['https://base.drpc.org', 'https://base.publicnode.com']
  }
}

export function isSupportedChain(value: string): value is SupportedChain {
  return value in CHAINS
}

export function chainByChainId(chainId: number): SupportedChain | undefined {
  return (Object.values(CHAINS).find((c) => c.chainId === chainId) as ChainConfig | undefined)?.id
}

export function isTokenSymbol(value: string): value is TokenSymbol {
  return value === 'USDT' || value === 'USDC'
}

export function getToken(chain: SupportedChain, symbol: TokenSymbol): TokenConfig {
  return CHAINS[chain].tokens[symbol]
}

export function publicChains() {
  return Object.values(CHAINS).map((c) => ({
    id: c.id,
    name: c.name,
    chainId: c.chainId,
    usdt: c.tokens.USDT.address,
    decimals: c.tokens.USDT.decimals,
    tokens: Object.values(c.tokens)
  }))
}
