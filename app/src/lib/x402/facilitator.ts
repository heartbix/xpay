import { verifySignature } from '@alephium/web3'
import { ExactPaymentPayload, ExactPaymentRequirements, SettleResult, VerifyResult } from './types'
import { computePaymentHash, getPaymentVault, getNodeProvider } from './vault'
import { hubFetch } from '@/lib/hub'

export { buildPaidJokeRequirements } from './requirements'

export async function verifyExactPayment(
  requirements: ExactPaymentRequirements,
  payment: ExactPaymentPayload
): Promise<VerifyResult> {
  try {
    getNodeProvider()
    const p = payment.payload
    if (payment.scheme !== 'exact') return { isValid: false, invalidReason: 'unsupported_scheme' }
    if (payment.network !== requirements.network) return { isValid: false, invalidReason: 'network_mismatch' }
    if (p.to !== requirements.payTo) return { isValid: false, invalidReason: 'payto_mismatch' }
    if (BigInt(p.amount) < BigInt(requirements.maxAmountRequired)) {
      return { isValid: false, invalidReason: 'underpaid' }
    }

    const deadline = BigInt(p.deadline)
    if (deadline < BigInt(Date.now())) return { isValid: false, invalidReason: 'expired' }

    const intent = await hubFetch<{ nonce: string; balanceAtomic: string; userId?: string }>(
      `/api/x402/intent?from=${encodeURIComponent(p.from)}`
    )
    if (!intent.userId) return { isValid: false, invalidReason: 'payer_not_found' }
    if (intent.nonce !== p.nonce) return { isValid: false, invalidReason: 'nonce_mismatch' }
    if (BigInt(intent.balanceAtomic || '0') < BigInt(p.amount)) {
      return { isValid: false, invalidReason: 'insufficient_balance' }
    }

    const hash = await computePaymentHash({
      from: p.from,
      to: p.to,
      amount: BigInt(p.amount),
      nonce: BigInt(p.nonce),
      deadline
    })

    const vault = getPaymentVault()
    const pub = await vault.view.getPublicKey({ args: { user: p.from } })
    const ok = verifySignature(hash, pub.returns, p.signature)
    if (!ok) return { isValid: false, invalidReason: 'bad_signature' }

    return { isValid: true, payer: p.from }
  } catch (e: any) {
    return { isValid: false, invalidReason: e?.message ?? 'verify_error' }
  }
}

export async function settleExactPayment(
  payment: ExactPaymentPayload,
  meta?: { slug?: string; priceAtomic?: string; totalAtomic?: string; httpMs?: number }
): Promise<SettleResult> {
  try {
    const p = payment.payload
    const result = await hubFetch<{ ok: boolean; txId: string }>('/api/x402/settle', {
      method: 'POST',
      body: JSON.stringify({
        slug: meta?.slug ?? '',
        payTo: p.to,
        payer: p.from,
        nonce: p.nonce,
        deadline: p.deadline,
        signature: p.signature,
        priceAtomic: meta?.priceAtomic ?? p.amount,
        totalAtomic: meta?.totalAtomic ?? p.amount,
        httpMs: meta?.httpMs
      }),
      signal: AbortSignal.timeout(30_000)
    })
    return { success: true, txId: result.txId }
  } catch (e: any) {
    return { success: false, errorReason: e?.message ?? 'settle_error' }
  }
}
