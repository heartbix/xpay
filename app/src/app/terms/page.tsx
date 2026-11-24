import { LegalPage } from '@/components/LegalPage'
import styles from '@/styles/Home.module.css'

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p className={styles.sectionLead}>Last updated 16 November 2026. XPay is operated by HeartBix. By creating an account you agree to these terms.</p>

      <h2 className={styles.sectionTitle}>What XPay is</h2>
      <p className={styles.sectionLead}>
        XPay is a <strong>USDT deposit hub</strong> with x402 micropayments. It is not a customer self-bridge, not a
        wallet login, and not Tether. You deposit USDT on a supported EVM network. HeartBix credits your XPay balance
        and holds that USDT in platform treasuries so you can pay x402 URLs or withdraw.
      </p>

      <h2 className={styles.sectionTitle}>Your USDT</h2>
      <p className={styles.sectionLead}>
        Deposits and withdrawals are real USDT on Ethereum, BSC, Polygon, Arbitrum, or Base. The amount credited is
        what arrived. Only the account that received the deposit can spend that balance on x402 or request a withdraw
        to an address that account saved. You may deposit on one network and withdraw on another; HeartBix routes
        treasury USDT to the payout network. HeartBix may sweep deposits to treasury; that does not change your ledger
        balance.
      </p>
      <p className={styles.sectionLead}>
        A newly saved withdrawal address cannot receive funds for <strong>24 hours</strong>. This delay protects your
        balance if someone else gains access to your account. You can save an address at any time; the account page
        shows when each one becomes ready.
      </p>

      <h2 className={styles.sectionTitle}>x402 and Alephium</h2>
      <p className={styles.sectionLead}>
        An x402 pay moves USDT on your XPay ledger (buyer → seller) as soon as the pay is accepted. HeartBix then
        records a MockUSDT transfer on <strong>Alephium testnet</strong> so History has an explorer hash. That testnet
        token is a receipt, not a second Tether balance and not Alephium mainnet. x402 does not charge a USDT fee;
        Alephium gas is sponsored.
      </p>

      <h2 className={styles.sectionTitle}>Fees</h2>
      <p className={styles.sectionLead}>
        Deposit and x402 have no USDT fee. Withdraw minimum is 1 USDT. A transfer fee is shown before you confirm; the
        amount must be greater than that fee. An x402 price of 0.001 means 0.001 USDT.
      </p>

      <h2 className={styles.sectionTitle}>Accounts</h2>
      <p className={styles.sectionLead}>
        You are responsible for your email or Google login and for API keys. Do not share keys. HeartBix may suspend
        accounts that abuse the service or that we cannot support.
      </p>

      <h2 className={styles.sectionTitle}>Service</h2>
      <p className={styles.sectionLead}>
        XPay is provided as-is. Ledgers, explorers, and networks can lag or fail. HeartBix is not a bank, not a
        licensed custodian in every jurisdiction, and not a party to what you sell on an x402 URL. Questions:{' '}
        <a href="https://heartbix.com">heartbix.com</a> or <a href="/support">Support</a>.
      </p>
    </LegalPage>
  )
}
