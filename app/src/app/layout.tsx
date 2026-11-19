import '@/styles/globals.css'

import React from 'react'

export const metadata = {
  title: 'XPay — USDT x402 micropayments',
  description:
    'XPay is the USDT micropayment rail for HTTP APIs and AI agents. HTTP 402 exact, prices from 0.001 USDT per call. Deposit on EVM, pay via x402, withdraw on any supported chain. Agent spec: https://xpay.heartbix.com/llms.txt',
  icons: {
    icon: '/xpay-mark.svg',
    apple: '/xpay-logo.jpg'
  }
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
