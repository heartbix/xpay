import { DocsPage } from '@/components/DocsPage'
import styles from '@/styles/Home.module.css'

export default function SupportX402Page() {
  return (
    <DocsPage title="X402 payments" current="x402">
      <p className={styles.lead}>
        XPay is built for USDT micropayments: a seller publishes a priced URL, the buyer gets HTTP 402, pays, and the
        seller is credited in USDT immediately. Agents should use this for per-call charges (from 0.001 USDT plus
        the live x402 fee). HeartBix posts an Alephium receipt hash; that is not a second Tether balance. Agent spec:{' '}
        <a href="/llms.txt">/llms.txt</a>.
      </p>

      <h2 className={styles.sectionTitle}>Do this in four steps</h2>
      <ol className={styles.processList}>
        <li>Log in → Fund → Deposit USDT (any supported chain).</li>
        <li>
          Seller: X402 Endpoint → slug <code>price1</code>, price <code>0.001</code> → Create. Copy the pay URL.
        </li>
        <li>Send that URL to the buyer (chat, docs, or your app). XPay does not send it for you.</li>
        <li>
          Buyer opens the URL (HTTP 402), signs, retries with <code>PAYMENT-SIGNATURE</code>. Check X402 transactions
          for sent / received.
        </li>
      </ol>
      <pre className={styles.codeBox}>{`# Buyer discovers the price
curl -i https://xpay.heartbix.com/api/pay/<seller-alph>/price1

# Buyer pays (signature from the 402 / wallet)
curl -i -H "PAYMENT-SIGNATURE: <base64>" \\
  https://xpay.heartbix.com/api/pay/<seller-alph>/price1`}</pre>

      <h2 className={styles.sectionTitle}>Seller</h2>
      <p className={styles.sectionLead}>
        The URL is unique because it includes your Alephium address:{' '}
        <code>https://xpay.heartbix.com/api/pay/&lt;your-alph&gt;/price1</code>. Every seller can reuse the same slug.
        Optional: one-off price with <code>?price=0.05</code> and your API key. The buyer still uses the same URL and
        does not need your key.
      </p>

      <h2 className={styles.sectionTitle}>Buyer</h2>
      <p className={styles.sectionLead}>
        First GET has no payment header → 402 with amount and <code>payTo</code>. Read the vault nonce (
        <code>GET /api/hub/x402/intent?from=&lt;buyer-alph&gt;</code>), sign, retry. Success is HTTP 200 with an
        Alephium <code>txId</code>. Same buyer: wait for 200 before the next pay (nonce +1). Different buyers can pay
        the same URL at once.
      </p>

      <h2 className={styles.sectionTitle}>USDT</h2>
      <p className={styles.sectionLead}>
        Deposit and withdraw are real USDT on EVM. You can deposit on one network and withdraw on another; HeartBix
        routes treasury USDT. Each x402 pay moves XPay USDT and includes a small live transaction fee (ALPH gas in
        USDT, rounded up). Withdraw to a 0x address has a separate transfer fee; send more than that fee.
      </p>
      <p className={styles.sectionLead}>
        API, Python examples with expected HTTP bodies, errors, balance, and withdraw:{' '}
        <a href="/support/api">API reference</a>.
      </p>
    </DocsPage>
  )
}