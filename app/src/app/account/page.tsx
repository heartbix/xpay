'use client'

import { Suspense } from 'react'
import { AccountApp } from '@/components/AccountApp'

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountApp />
    </Suspense>
  )
}
