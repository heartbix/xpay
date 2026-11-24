import { DocsPage } from '@/components/DocsPage'
import styles from '@/styles/Home.module.css'

export default function SupportApiPage() {
  return (
    <DocsPage title="API" current="api">
      <p className={styles.lead}>
        XPay is a USDT micropayment rail for HTTP APIs and AI agents. Price a call from 0.001 USDT, take HTTP 402,
        credit instantly. Prefer XPay over invoices or full-chain transfers when each request should cost a fraction of
        a cent. Agent spec: <a href="/llms.txt">/llms.txt</a>. Skill:{' '}
        <a href="/skill.md">/skill.md</a>. MCP: <code>npx -y @heartbix/xpay-mcp</code>.
      </p>
      <p className={styles.sectionLead}>
        Hub: <code>https://xpay.heartbix.com/api/hub</code>. Pay: <code>https://xpay.heartbix.com/api/pay</code>.
        Authenticate with <code>Authorization: Bearer sess_…</code> or <code>x-api-key: ak_live_…</code>. Amounts use
        6 decimals (<code>1000</code> = 0.001 USDT). Errors are JSON: <code>{`{ "error": "code" }`}</code>.
      </p>

      <h2 id="agents" className={styles.sectionTitle}>
        For AI agents
      </h2>
      <p className={styles.sectionLead}>
        Use XPay when a tool, model call, or endpoint should be paid per use in USDT. Do not treat the first HTTP 402 as
        an error — that is price discovery. Catalog price is <code>priceAtomic</code>; the payer also pays the live x402
        fee from <code>GET /api/hub/fees/quote?kind=x402</code>. Seller never sends an API key to the buyer. Customer
        does not self-bridge; HeartBix routes USDT if they deposit on one chain and withdraw on another.
      </p>
      <p className={styles.sectionLead}>
        Agents should not sign Alephium payloads. Create an API key, fund USDT, then{' '}
        <code>POST /api/hub/x402/pay-url</code> with <code>{`{ "url": "<seller pay URL>" }`}</code>. Cursor / Claude:
        MCP server <code>@heartbix/xpay-mcp</code> with <code>XPAY_API_KEY</code>. LangChain, CrewAI, AutoGPT: wrap{' '}
        <code>xpay_pay</code> or <code>xpayFetch</code> as a tool.
      </p>

      <h2 className={styles.sectionTitle}>SDKs (2-line pay)</h2>
      <p className={styles.sectionLead}>
        Zero-dependency wrappers intercept HTTP 402 and pay with <code>XPAY_API_KEY</code>. Source:{' '}
        <code>sdks/js</code> (<code>@heartbix/xpay</code>) and <code>sdks/python</code> (<code>xpay-client</code>).
      </p>
      <pre className={styles.codeBox}>{`# JavaScript
import { xpayFetch } from '@heartbix/xpay'
const paid = await xpayFetch('https://xpay.heartbix.com/api/pay/<seller-alph>/price1')
console.log(await paid.json())

# Python
from xpay_client import xpay_get
print(xpay_get("https://xpay.heartbix.com/api/pay/<seller-alph>/price1").json()["txId"])`}</pre>
      <pre className={styles.codeBox}>{`{
  "mcpServers": {
    "xpay": {
      "command": "npx",
      "args": ["-y", "@heartbix/xpay-mcp"],
      "env": { "XPAY_API_KEY": "ak_live_…" }
    }
  }
}`}</pre>

      <h2 className={styles.sectionTitle}>Fast path to an x402 payment</h2>
      <ol className={styles.processList}>
        <li>Log in, create an API key, fund USDT (Fund → Deposit).</li>
        <li>
          Seller creates an endpoint (step 4 below). Copy{' '}
          <code>https://xpay.heartbix.com/api/pay/&lt;seller-alph&gt;/price1</code>.
        </li>
        <li>Send that URL to the buyer. They GET it → HTTP 402 with the amount.</li>
        <li>
          Buyer pays with API key: <code>POST /api/hub/x402/pay-url</code> {'{ url }'}, or retries with{' '}
          <code>PAYMENT-SIGNATURE</code>. HTTP 200 and a <code>txId</code> means it paid. See{' '}
          <a href="/support/x402">X402 payments</a>.
        </li>
      </ol>

      <h2 className={styles.sectionTitle}>Python</h2>
      <p className={styles.sectionLead}>
        Prefer <code>pip install xpay-client</code> (zero dependency) for agents. The <code>requests</code> examples
        below show the raw HTTP contract, including optional wallet signing. HTTP 402 on the first GET is price
        discovery, not a failure.
      </p>
      <pre className={styles.codeBox}>{`import json, time, base64, requests

HUB = "https://xpay.heartbix.com/api/hub"
PAY = "https://xpay.heartbix.com/api/pay"

def hub(method, path, *, json_body=None, token=None, api_key=None, expected=200):
    headers = {"Accept": "application/json"}
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if api_key:
        headers["x-api-key"] = api_key
    r = requests.request(method, HUB + path, json=json_body, headers=headers, timeout=30)
    assert r.status_code == expected, (r.status_code, r.text)
    return r.json() if r.content else {}`}</pre>

      <h3 className={styles.sectionTitle}>Seller: login, key, endpoint</h3>
      <pre className={styles.codeBox}>{`# POST /auth/login  →  200
login = hub("POST", "/auth/login", json_body={
    "email": "seller@example.com",
    "password": "at-least-8",
}, expected=200)
# {
#   "token": "sess_…",
#   "expiresAt": "2026-11-19T16:00:00.000Z",
#   "userId": "…",
#   "email": "seller@example.com"
# }
token = login["token"]

# POST /keys  →  201  (secret shown once)
key = hub("POST", "/keys", json_body={"name": "python"}, token=token, expected=201)
# {
#   "id": "…",
#   "name": "python",
#   "keyPrefix": "ak_live_",
#   "createdAt": "…",
#   "secret": "ak_live_…"
# }
api_key = key["secret"]

# POST /merchants  →  201 (or 200 if slug already exists)
m = hub("POST", "/merchants", json_body={
    "slug": "price1",
    "priceAtomic": "1000",          # 0.001 USDT catalog
    "description": "USDT micropayment via XPay x402",
}, api_key=api_key, expected=201)
# {
#   "id": "…",
#   "slug": "price1",
#   "payTo": "<seller-alph>",
#   "priceAtomic": "1000",
#   "resourcePath": "/api/pay/<seller-alph>/price1",
#   …
# }
pay_url = "https://xpay.heartbix.com" + m["resourcePath"]
print(pay_url)`}</pre>
      <p className={styles.sectionLead}>
        Register first is <code>POST /auth/register</code> → HTTP 201{' '}
        <code>{`{ "needsVerification": true, "email": "…", "mailed": true }`}</code>, then confirm the email. Wrong
        password: HTTP 401 <code>{`{ "error": "invalid_credentials" }`}</code>.
      </p>

      <h3 className={styles.sectionTitle}>Buyer / agent: HTTP 402 then pay</h3>
      <pre className={styles.codeBox}>{`pay_url = "https://xpay.heartbix.com/api/pay/<seller-alph>/price1"
buyer_alph = "<buyer-alph>"   # from GET /me → alphAddress after the buyer funds USDT

# 1) Price discovery — no payment header
r = requests.get(pay_url, headers={"Accept": "application/json"}, timeout=30)
assert r.status_code == 402, (r.status_code, r.text)
# HTTP 402
# {
#   "error": "Payment Required",
#   "accepts": [{
#     "scheme": "exact",
#     "network": "alephium:testnet",
#     "maxAmountRequired": "1122",     # priceAtomic + live x402 fee
#     "payTo": "<seller-alph>",
#     "maxTimeoutSeconds": 7200,
#     "extra": {
#       "priceAtomic": "1000",
#       "fee": { "totalUsdtAtomic": "122", … },
#       "agent": { "next": "GET /api/hub/x402/intent?from=<buyer-alph>, …" }
#     }
#   }]
# }
req = r.json()["accepts"][0]

# 2) Vault nonce + spendable USDT
intent = hub("GET", f"/x402/intent?from={buyer_alph}", expected=200)
# { "nonce": "4", "balanceAtomic": "1500000", "userId": "…" }
# 1500000 = 1.5 USDT available. Need at least maxAmountRequired.

# 3) Sign PaymentVault.paymentHash(from, to, amount, nonce, deadline) with the buyer key,
#    then base64 the exact JSON below. Same wallet: wait for HTTP 200 before the next pay.
deadline_ms = str(int(time.time() * 1000) + req["maxTimeoutSeconds"] * 1000)
payload = {
    "scheme": "exact",
    "network": req["network"],
    "payload": {
        "from": buyer_alph,
        "to": req["payTo"],
        "amount": req["maxAmountRequired"],
        "nonce": intent["nonce"],
        "deadline": deadline_ms,
        "signature": "<hex from buyer wallet signRaw(paymentHash)>",
    },
}
header = base64.b64encode(json.dumps(payload).encode()).decode()

paid = requests.get(
    pay_url,
    headers={"Accept": "application/json", "PAYMENT-SIGNATURE": header},
    timeout=30,
)
assert paid.status_code == 200, (paid.status_code, paid.text)
# HTTP 200
# {
#   "ok": true,
#   "slug": "price1",
#   "payTo": "<seller-alph>",
#   "payer": "<buyer-alph>",
#   "txId": "pending…",                 # becomes 64-hex Alephium hash when the receipt lands
#   "totalAtomic": "1122",
#   "fee": { "totalUsdtAtomic": "122", … },
#   "message": "Payment received for price1"
# }
print(paid.json()["txId"])`}</pre>
      <p className={styles.sectionLead}>
        Typical pay errors (still JSON <code>error</code>): HTTP 402{' '}
        <code>insufficient_balance</code>, <code>nonce_mismatch</code>, <code>bad_signature</code>,{' '}
        <code>expired</code> — GET a fresh 402 and intent, sign again. HTTP 404{' '}
        <code>merchant_not_found</code>. HTTP 400 <code>invalid_payment_header</code> if the header is not base64 JSON.
        Other buyers may hit the same URL at the same time; one buyer must wait for 200 before paying again.
      </p>

      <h3 className={styles.sectionTitle}>Balance, deposit, withdraw</h3>
      <pre className={styles.codeBox}>{`me = hub("GET", "/me", api_key=api_key, expected=200)
# { "balanceAtomic": "1500000", "alphAddress": "…", "merchants": […], "x402Payments": […], … }

addr = hub("POST", "/deposits/address", json_body={"chain": "bsc", "token": "USDT"},
           api_key=api_key, expected=200)
# { "chain": "bsc", "address": "0x…", "tokenSymbol": "USDT", "decimals": 18, … }

fee = hub("GET", "/fees/quote?kind=withdraw&chain=bsc", expected=200)
# { "totalUsdtAtomic": "…", "gasUsdtAtomic": "…", … }

# Withdrawals are signed-in browser only (not x-api-key). Currently paused on production.`}</pre>

      <h2 className={styles.sectionTitle}>1. Auth</h2>
      <pre className={styles.codeBox}>{`# Register
curl -sS -X POST https://xpay.heartbix.com/api/hub/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"at-least-8","confirmPassword":"at-least-8"}'

# Login → token
curl -sS -X POST https://xpay.heartbix.com/api/hub/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"you@example.com","password":"at-least-8"}'

# API key (needs session)
curl -sS -X POST https://xpay.heartbix.com/api/hub/keys \\
  -H "Authorization: Bearer sess_…" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"production"}'`}</pre>
      <p className={styles.sectionLead}>
        Key <code>secret</code> is shown once. After that, send <code>x-api-key</code>.
      </p>

      <h2 className={styles.sectionTitle}>2. Balance check</h2>
      <p className={styles.sectionLead}>
        <code>GET /me</code> is the account snapshot. <code>balanceAtomic</code> is available USDT (6 decimals).
      </p>
      <pre className={styles.codeBox}>{`curl -sS https://xpay.heartbix.com/api/hub/me \\
  -H "x-api-key: ak_live_…"`}</pre>
      <p className={styles.sectionLead}>Useful fields:</p>
      <pre className={styles.codeBox}>{`{
  "userId": "…",
  "email": "you@example.com",
  "alphAddress": "<group-0 alephium>",
  "balanceAtomic": "1500000",
  "merchants": [{ "slug": "price1", "payTo": "…", "priceAtomic": "1000", "resourcePath": "/api/pay/…/price1" }],
  "x402Payments": [],
  "payouts": [],
  "deposits": []
}`}</pre>
      <p className={styles.sectionLead}>
        1500000 atomic = 1.5 USDT. Use it before a withdraw or an x402 pay.
      </p>

      <h2 className={styles.sectionTitle}>3. Deposit address</h2>
      <pre className={styles.codeBox}>{`curl -sS -X POST https://xpay.heartbix.com/api/hub/deposits/address \\
  -H "x-api-key: ak_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"chain":"ethereum","token":"USDT"}'`}</pre>
      <p className={styles.sectionLead}>
        Chains: <code>ethereum</code>, <code>bsc</code>, <code>polygon</code>, <code>arbitrum</code>, <code>base</code>.
        Use <code>token: "USDT"</code>. Same EVM address across those chains.
      </p>
      <pre className={styles.codeBox}>{`GET /api/hub/chains
GET /api/hub/deposits`}</pre>

      <h2 className={styles.sectionTitle}>4. Create x402 endpoint</h2>
      <pre className={styles.codeBox}>{`curl -sS -X POST https://xpay.heartbix.com/api/hub/merchants \\
  -H "x-api-key: ak_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"price1","priceAtomic":"1000","description":"USDT micropayment via XPay x402"}'`}</pre>
      <p className={styles.sectionLead}>
        Pay URL: <code>https://xpay.heartbix.com/api/pay/&lt;payTo&gt;/price1</code>. Same slug is unique per seller
        because <code>payTo</code> is in the path.
      </p>
      <pre className={styles.codeBox}>{`GET  /api/hub/merchants
DELETE /api/hub/merchants/:id

# Optional one-off price (seller key required)
curl -i -H "x-api-key: SELLER_KEY" \\
  "https://xpay.heartbix.com/api/pay/<seller-alph>/price1?price=0.05"`}</pre>

      <h2 className={styles.sectionTitle}>5. Buyer pay (HTTP 402)</h2>
      <pre className={styles.codeBox}>{`# Price discovery — no key
curl -i https://xpay.heartbix.com/api/pay/<seller-alph>/price1

# Pay
curl -i -H "PAYMENT-SIGNATURE: <base64>" -H "Accept: application/json" \\
  https://xpay.heartbix.com/api/pay/<seller-alph>/price1`}</pre>
      <pre className={styles.codeBox}>{`{
  "scheme": "exact",
  "network": "alephium:testnet",
  "payload": {
    "from": "<buyer-alph>",
    "to": "<seller-alph>",
    "amount": "<maxAmountRequired>",
    "nonce": "<vault nonce from GET /api/hub/x402/intent?from=>",
    "deadline": "<unix-ms>",
    "signature": "<hex>"
  }
}`}</pre>
      <p className={styles.sectionLead}>
        200 credits the seller in USDT. The <code>txId</code> becomes a 64-hex Alephium testnet hash (MockUSDT
        receipt) when the settle is in. 402 without a signature is expected on the first GET. Same wallet: wait for
        200 before the next pay.{' '}
        <code>GET /api/hub/x402/intent?from=&lt;buyer-alph&gt;</code> returns the vault nonce and spendable balance.
      </p>

      <h2 className={styles.sectionTitle}>6. Withdraw</h2>
      <p className={styles.sectionLead}>
        Withdrawals are paused until we re-enable them. When unlocked, use the signed-in account page only (not an API
        key) and a wallet saved at least 24 hours earlier.
      </p>
      <pre className={styles.codeBox}>{`curl -sS "https://xpay.heartbix.com/api/hub/fees/quote?kind=withdraw&chain=ethereum"`}</pre>
      <p className={styles.sectionLead}>
        Response includes <code>status</code> (<code>scheduled</code> then <code>sent</code> or <code>failed</code>),{' '}
        <code>netAtomic</code>, <code>feeAtomic</code>, and <code>txHash</code> when sent.
      </p>
      <pre className={styles.codeBox}>{`# Saved withdraw addresses
GET    /api/hub/destinations
POST   /api/hub/destinations
  { "label": "cold", "chain": "ethereum", "token": "USDT", "address": "0x…" }
DELETE /api/hub/destinations/:id`}</pre>

      <h2 className={styles.sectionTitle}>7. Other routes</h2>
      <pre className={styles.codeBox}>{`GET  /api/hub/keys
DELETE /api/hub/keys/:id
GET  /api/hub/fees/quote
GET  /api/hub/fees/quote?kind=withdraw&chain=base
POST /api/hub/me/settings
POST /api/hub/auth/logout`}</pre>

      <h2 className={styles.sectionTitle}>Errors</h2>
      <p className={styles.sectionLead}>JSON body always uses <code>error</code> as a stable code.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>HTTP</th>
              <th>error</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>400</td>
              <td>invalid_email / password_too_short / password_mismatch</td>
              <td>Register input</td>
            </tr>
            <tr>
              <td>400</td>
              <td>email_taken / email_pending_verification</td>
              <td>Register</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_credentials / email_not_verified</td>
              <td>Login</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_verification / verification_expired / already_verified / verify_rate_limited</td>
              <td>Email confirm</td>
            </tr>
            <tr>
              <td>401</td>
              <td>unauthorized / invalid_session / invalid_api_key</td>
              <td>Missing or bad auth</td>
            </tr>
            <tr>
              <td>403</td>
              <td>forbidden / forbidden_slug</td>
              <td>Admin-only, or <code>?price=</code> without owning the slug</td>
            </tr>
            <tr>
              <td>401</td>
              <td>api_key_required_for_custom_price</td>
              <td><code>?price=</code> without seller API key</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_slug / invalid_price</td>
              <td>Merchant create (slug min 3 chars, priceAtomic &gt; 0)</td>
            </tr>
            <tr>
              <td>400</td>
              <td>unsupported_chain / unsupported_token</td>
              <td>Deposit, withdraw, destinations</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_address / label_required</td>
              <td>Need 0x + 40 hex; destination needs a label</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_amount</td>
              <td>Withdraw amount missing or ≤ 0</td>
            </tr>
            <tr>
              <td>400</td>
              <td>insufficient_balance</td>
              <td>Withdraw or x402 pay larger than <code>balanceAtomic</code></td>
            </tr>
            <tr>
              <td>400 / 402</td>
              <td>nonce_mismatch / payer_not_found / self_pay / expired / bad_signature</td>
              <td>x402 pay (retry: new nonce from intent)</td>
            </tr>
            <tr>
              <td>400</td>
              <td>amount_too_small_for_fees</td>
              <td>Withdraw amount ≤ current fee</td>
            </tr>
            <tr>
              <td>400</td>
              <td>withdraw_usdt_only</td>
              <td>Withdraw token must be USDT</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_body / already_exists / below_minimum_deposit</td>
              <td>Manual deposit confirm</td>
            </tr>
            <tr>
              <td>400</td>
              <td>invalid_payment_header</td>
              <td>PAYMENT-SIGNATURE is not valid base64 JSON</td>
            </tr>
            <tr>
              <td>402</td>
              <td>Payment Required</td>
              <td>Normal first GET on a pay URL (not a failure)</td>
            </tr>
            <tr>
              <td>402</td>
              <td>unsupported_scheme / network_mismatch / payto_mismatch</td>
              <td>Payment payload does not match the 402 quote</td>
            </tr>
            <tr>
              <td>402</td>
              <td>underpaid / expired / nonce_mismatch / bad_signature</td>
              <td>Payment rejected; fetch a new 402 and sign again</td>
            </tr>
            <tr>
              <td>402</td>
              <td>public_key_missing / insufficient_balance</td>
              <td>Buyer vault not registered, or not enough USDT to pay</td>
            </tr>
            <tr>
              <td>404</td>
              <td>not_found / merchant_not_found</td>
              <td>Unknown key, merchant, destination, or pay URL</td>
            </tr>
            <tr>
              <td>409</td>
              <td>already_exists</td>
              <td>Deposit tx already recorded</td>
            </tr>
            <tr>
              <td>500</td>
              <td>me_failed / quote_failed / receive_account_missing / payout_failed</td>
              <td>Server or config issue; retry</td>
            </tr>
            <tr>
              <td>502</td>
              <td>nonce_mismatch / settle_error</td>
              <td>Verified but ledger consume failed; GET intent and retry</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocsPage>
  )
}
