# HeartBix XPay

USDT micropayment rail for HTTP APIs and AI agents. HTTP 402 exact (x402). Live: [xpay.heartbix.com](https://xpay.heartbix.com)

Agent spec: [xpay.heartbix.com/llms.txt](https://xpay.heartbix.com/llms.txt)

- Deposit real USDT on Ethereum, BSC, Polygon, Arbitrum, or Base
- Pay priced URLs via x402 (catalog from 0.001 USDT + live fee)
- On-chain receipts on Alephium (testnet MockUSDT today)
- Withdraw USDT on a supported EVM chain; HeartBix routes

Agents should not sign PaymentVault. Create an API key, fund USDT, then `POST /api/hub/x402/pay-url` with `{ "url" }`.

```js
import { xpayFetch } from '@heartbix/xpay'
const paid = await xpayFetch('https://xpay.heartbix.com/api/pay/<seller-alph>/price1')
```

```python
from xpay_client import xpay_get
print(xpay_get("https://xpay.heartbix.com/api/pay/<seller-alph>/price1").json()["txId"])
```

MCP: `npx -y @heartbix/xpay-mcp` with `XPAY_API_KEY`.

## Layout

- `app/` — Next.js site (xpay.heartbix.com)
- `hub/` — Deposit hub, auth, x402 settle queue, mail
- `contracts/` — Ralph MockUSDT + PaymentVault (Alephium testnet)
- `sdks/js` — npm `@heartbix/xpay`
- `sdks/python` — PyPI `xpay-client`
- `sdks/mcp` — npm `@heartbix/xpay-mcp`

## Local

```bash
yarn install
cp .env.example .env   # fill locally; never commit
yarn dev:hub           # http://127.0.0.1:43142
yarn dev               # http://127.0.0.1:3000
```

Do not commit `HUB_MNEMONIC`, SMTP passwords, OAuth secrets, or API tokens.
