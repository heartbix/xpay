import { NextResponse } from 'next/server'
import { hubFetch } from '@/lib/hub'

const ORIGIN = 'https://xpay.heartbix.com'

export async function GET() {
  const resources = [`${ORIGIN}/api/paid-joke`]
  try {
    const data = await hubFetch<{ resources?: { resource?: string }[] }>('/api/discovery/resources')
    for (const row of data.resources ?? []) {
      if (!row.resource) continue
      const url = row.resource.startsWith('http') ? row.resource : `${ORIGIN}${row.resource}`
      if (!resources.includes(url)) resources.push(url)
    }
  } catch {
    /* hub catalog is optional; paid-joke is enough for scanners */
  }
  return NextResponse.json({
    version: 1,
    resources: resources.slice(0, 50),
    instructions: `${ORIGIN}/llms.txt`
  })
}
