---
name: xpay
description: Pay and sell USDT micropayments on HeartBix XPay (HTTP 402 / x402). Use when an agent must pay a priced URL, create a paid endpoint, or integrate USDT micropayments. Prefer the API key + pay-url path, @heartbix/xpay, xpay-client, or the XPay MCP server. Never treat the first HTTP 402 as a failure.
---

# XPay agent skill

Site: https://xpay.heartbix.com
Spec: https://xpay.heartbix.com/llms.txt
Hub: https://xpay.heartbix.com/api/hub

## Setup

1. Create an account: https://xpay.heartbix.com/account?mode=register
2. Fund USDT (Fund → Deposit).
3. Create an API key (`ak_live_…`). Put it in `XPAY_API_KEY`. Never put a seller key in a buyer tool.

## Pay a seller URL

Preferred:

```
POST /api/hub/x402/pay-url
x-api-key: $XPAY_API_KEY
{ "url": "https://xpay.heartbix.com/api/pay/<seller-alph>/price1" }
```

Quote without paying: `GET /api/hub/x402/pay-url?url=…`

JS: `import { xpayFetch } from '@heartbix/xpay'` then `await xpayFetch(url)`.
Python: `from xpay_client import xpay_get` then `xpay_get(url).json()`.
MCP: tools `xpay_quote` and `xpay_pay`.

## Sell

`POST /api/hub/merchants` with `{ "slug", "priceAtomic", "description" }`.
`priceAtomic` is 6-decimal USDT (`1000` = 0.001). Share only the pay URL, never the API key.

## Rules

- HTTP 402 on the first GET of a pay URL is the price, not an error.
- Catalog + live x402 fee = `maxAmountRequired`.
- Same buyer: wait for HTTP 200 before the next pay.
- Customer does not self-bridge; HeartBix routes withdraws.
