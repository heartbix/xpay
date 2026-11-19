import { SignerProvider } from '@alephium/web3'
import { ExactPaymentPayload, ExactPaymentRequirements } from './types'
import { computePaymentHash } from './vault'
import { hubFetch } from '@/lib/hub'

/** Build and sign an exact x402 payment (hub nonce, vault signature). */
export async function createExactPaymentPayload(params: {
  signer: SignerProvider
  from: string
  requirements: ExactPaymentRequirements
}): Promise<ExactPaymentPayload> {
  const { signer, from, requirements } = params
  const intent = await hubFetch<{ nonce: string }>(`/api/x402/intent?from=${encodeURIComponent(from)}`)
  const amount = requirements.maxAmountRequired
  const nonce = intent.nonce
  const deadline = (BigInt(Date.now()) + BigInt(requirements.maxTimeoutSeconds) * 1000n).toString()
  const to = requirements.payTo

  const hash = await computePaymentHash({
    from,
    to,
    amount: BigInt(amount),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline)
  })

  // Prefer raw hash sign when available (PrivateKeyWallet / extension adapters)
  const anySigner = signer as any
  let signature: string
  if (typeof anySigner.signRaw === 'function') {
    signature = await anySigner.signRaw(from, hash)
  } else {
    const signed = await signer.signMessage({
      signerAddress: from,
      message: hash,
      messageHasher: 'identity'
    })
    signature = signed.signature
  }

  return {
    scheme: 'exact',
    network: requirements.network,
    payload: { from, to, amount, nonce, deadline, signature }
  }
}
