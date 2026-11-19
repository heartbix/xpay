'use client'

import React, { useCallback, useState } from 'react'
import styles from '../styles/Home.module.css'
import {
  claimMockUsdt,
  depositToVault,
  registerVaultKey,
  sponsoredPing
} from '@/services/rail.service'
import { TxStatus } from './TxStatus'
import { useWallet } from '@alephium/web3-react'
import { node } from '@alephium/web3'
import { RailConfig } from '@/services/utils'
import { createExactPaymentPayload } from '@/lib/x402/client'
import { buildPaidJokeRequirements } from '@/lib/x402/requirements'

export function RailDapp({ config }: { config: RailConfig }) {
  const { signer, account } = useWallet()
  const [ongoingTxId, setOngoingTxId] = useState<string>()
  const [lastAction, setLastAction] = useState<string>()
  const [joke, setJoke] = useState<string>()
  const [error, setError] = useState<string>()

  const txStatusCallback = useCallback(async (status: node.TxStatus, numberOfChecks: number) => {
    if ((status.type === 'Confirmed' && numberOfChecks > 2) || (status.type === 'TxNotFound' && numberOfChecks > 3)) {
      setOngoingTxId(undefined)
    }
  }, [])

  const run = async (label: string, fn: () => Promise<{ txId: string }>) => {
    if (!signer) return
    setError(undefined)
    setLastAction(label)
    try {
      const result = await fn()
      setOngoingTxId(result.txId)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  const onClaim = () =>
    run('claim', () => claimMockUsdt(signer!, config.mockUsdtTokenId))

  const onSponsoredPing = () =>
    run('sponsored-ping', () =>
      sponsoredPing(signer!, config.gasSponsorContractId, config.mockUsdtTokenId, config.usdtFee)
    )

  const onRegisterKey = () => {
    if (!account?.publicKey) {
      setError('Wallet public key unavailable')
      return
    }
    return run('register-key', () => registerVaultKey(signer!, config.paymentVaultContractId, account.publicKey))
  }

  const onDeposit = () =>
    run('deposit', () =>
      depositToVault(signer!, config.paymentVaultContractId, config.mockUsdtTokenId, 20n * 1_000_000n)
    )

  const onPaidJoke = async () => {
    if (!signer || !account?.address) return
    setError(undefined)
    setJoke(undefined)
    setLastAction('paid-joke')
    try {
      const requirements = buildPaidJokeRequirements('/api/paid-joke')
      requirements.extra.vaultAddress = config.paymentVaultAddress
      const payment = await createExactPaymentPayload({
        signer,
        from: account.address,
        requirements
      })
      const header = Buffer.from(JSON.stringify(payment)).toString('base64')
      const res = await fetch('/api/paid-joke', {
        headers: { 'PAYMENT-SIGNATURE': header }
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? res.statusText)
        return
      }
      setJoke(body.joke)
      if (body.txId) setOngoingTxId(body.txId)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  const feeLabel = `${Number(config.usdtFee) / 1_000_000} MUSDT`

  return (
    <div className={styles.rail}>
      <p className={styles.kicker}>Demo</p>
      <h1 className={styles.title}>USDT rail + x402</h1>
      <p className={styles.lead}>
        Claim MockUSDT, deposit into PaymentVault, then buy a joke with an x402 exact payment (gas via facilitator /
        sponsor path).
      </p>

      <div className={styles.meta}>
        <div>
          <span>Network</span>
          <strong>{config.network}</strong>
        </div>
        <div>
          <span>Wallet</span>
          <strong>{account?.address ? `${account.address.slice(0, 8)}…${account.address.slice(-6)}` : '—'}</strong>
        </div>
        <div>
          <span>Sponsored fee</span>
          <strong>{feeLabel}</strong>
        </div>
      </div>

      {ongoingTxId && (
        <div className={styles.statusBox}>
          <p>Last action: {lastAction}</p>
          <TxStatus txId={ongoingTxId} txStatusCallback={txStatusCallback} />
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {joke && <p className={styles.joke}>{joke}</p>}

      <div className={styles.actions}>
        <button type="button" disabled={!!ongoingTxId || !signer} onClick={onClaim}>
          1. Claim 100 MockUSDT
        </button>
        <button type="button" disabled={!!ongoingTxId || !signer} onClick={onSponsoredPing}>
          2. Sponsored ping ({feeLabel})
        </button>
        <button type="button" disabled={!!ongoingTxId || !signer} onClick={onRegisterKey}>
          3. Register vault signing key
        </button>
        <button type="button" disabled={!!ongoingTxId || !signer} onClick={onDeposit}>
          4. Deposit 20 MUSDT to vault
        </button>
        <button type="button" disabled={!!ongoingTxId || !signer} onClick={onPaidJoke}>
          5. Buy joke via x402 (1 MUSDT)
        </button>
      </div>

      <details className={styles.details}>
        <summary>Contract ids</summary>
        <p>MockUSDT: {config.mockUsdtTokenId}</p>
        <p>GasSponsor: {config.gasSponsorContractId}</p>
        <p>PaymentVault: {config.paymentVaultContractId}</p>
      </details>
    </div>
  )
}
