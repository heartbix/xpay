import { DUST_AMOUNT, ExecuteScriptResult, MINIMAL_CONTRACT_DEPOSIT, SignerProvider } from '@alephium/web3'
import {
  ClaimMockUSDT,
  DepositToVault,
  RegisterVaultKey,
  SponsoredPing,
  WithdrawFromVault
} from 'my-contracts'

export const claimMockUsdt = async (signer: SignerProvider, tokenId: string): Promise<ExecuteScriptResult> => {
  return await ClaimMockUSDT.execute(signer, {
    initialFields: { token: tokenId },
    attoAlphAmount: DUST_AMOUNT * 2n
  })
}

export const sponsoredPing = async (
  signer: SignerProvider,
  sponsorContractId: string,
  usdtTokenId: string,
  usdtFee: bigint
): Promise<ExecuteScriptResult> => {
  return await SponsoredPing.execute(signer, {
    initialFields: {
      sponsor: sponsorContractId,
      usdtTokenId,
      usdtFee
    },
    attoAlphAmount: DUST_AMOUNT * 2n,
    tokens: usdtFee > 0n ? [{ id: usdtTokenId, amount: usdtFee }] : undefined
  })
}

export const registerVaultKey = async (
  signer: SignerProvider,
  vaultContractId: string,
  publicKey: string
): Promise<ExecuteScriptResult> => {
  return await RegisterVaultKey.execute(signer, {
    initialFields: { vault: vaultContractId, publicKey },
    attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT + DUST_AMOUNT
  })
}

export const depositToVault = async (
  signer: SignerProvider,
  vaultContractId: string,
  usdtTokenId: string,
  amount: bigint
): Promise<ExecuteScriptResult> => {
  return await DepositToVault.execute(signer, {
    initialFields: { vault: vaultContractId, usdtTokenId, amount },
    attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 2n + DUST_AMOUNT,
    tokens: [{ id: usdtTokenId, amount }]
  })
}

export const withdrawFromVault = async (
  signer: SignerProvider,
  vaultContractId: string,
  amount: bigint
): Promise<ExecuteScriptResult> => {
  return await WithdrawFromVault.execute(signer, {
    initialFields: { vault: vaultContractId, amount },
    attoAlphAmount: DUST_AMOUNT * 2n
  })
}
