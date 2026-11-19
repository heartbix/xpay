import { DocsPage, SupportCards } from '@/components/DocsPage'
import { TicketForm } from '@/components/TicketForm'
import styles from '@/styles/Home.module.css'

export default function SupportIndexPage() {
  return (
    <DocsPage title="Support" current="index">
      <p className={styles.lead}>
        XPay is the USDT micropayment rail for HTTP 402. Guides for sellers, buyers, and AI agents. Agent spec:{' '}
        <a href="/llms.txt">/llms.txt</a>. Skill: <a href="/skill.md">/skill.md</a>. MCP:{' '}
        <code>npx -y @heartbix/xpay-mcp</code>.
      </p>
      <SupportCards />
      <TicketForm />
    </DocsPage>
  )
}
