# Contracts — Phase 1

Ralph contracts for the Alephium USDT rail.

## Contracts

- `mock_usdt.ral` — faucet fungible token (6 decimals)
- `gas_sponsor.ral` — gas sponsorship + optional USDT fee
- `claim_mock_usdt.ral` / `sponsored_ping.ral` — TxScripts

## Commands

From repo root:

```bash
yarn compile
yarn test
yarn deploy
```

Deploy order is numeric: `0_deploy_mock_usdt.ts` then `1_deploy_gas_sponsor.ts`.
