import { LegalPage } from '@/components/LegalPage'
import styles from '@/styles/Home.module.css'

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p className={styles.sectionLead}>Last updated 16 November 2026. XPay is operated by HeartBix.</p>

      <h2 className={styles.sectionTitle}>What we store</h2>
      <p className={styles.sectionLead}>
        Account email and name (including from Google or GitHub if you use them), password hash if you register with
        email, API keys you create, deposit addresses, payment and withdraw history, payout addresses you save, and
        your Alephium address used for x402.
      </p>

      <h2 className={styles.sectionTitle}>What is public</h2>
      <p className={styles.sectionLead}>
        x402 receipts are MockUSDT transfers on Alephium testnet. Those transaction hashes and addresses are on a
        public explorer. EVM deposit and withdraw hashes are public on those chains.
      </p>

      <h2 className={styles.sectionTitle}>How we use it</h2>
      <p className={styles.sectionLead}>
        We use this to run login, funding, x402, withdraws, and optional low-balance emails (only if you enable
        them). We do not sell your personal data.
      </p>

      <h2 className={styles.sectionTitle}>Questions</h2>
      <p className={styles.sectionLead}>
        HeartBix: <a href="https://heartbix.com">heartbix.com</a>. Product help: <a href="/support">Support</a>.
      </p>
    </LegalPage>
  )
}
