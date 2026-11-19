import { NextRequest, NextResponse } from 'next/server'
import { getHubBaseUrl } from '@/lib/hub'

const PROVIDERS = new Set(['google', 'github'])

export async function GET(req: NextRequest, ctx: { params: { provider: string } }) {
  const provider = ctx.params.provider
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unsupported_provider' }, { status: 404 })
  }
  const upstream = await fetch(`${getHubBaseUrl()}/api/auth/${provider}`, {
    redirect: 'manual',
    cache: 'no-store'
  })
  const location = upstream.headers.get('location')
  if (location) {
    try {
      const dest = new URL(location)
      if (dest.hostname === '127.0.0.1' || dest.hostname === 'localhost') {
        dest.protocol = req.nextUrl.protocol
        dest.host = req.nextUrl.host
        return NextResponse.redirect(dest)
      }
    } catch {
      /* use hub location as-is */
    }
    return NextResponse.redirect(location)
  }
  return NextResponse.redirect(new URL('/account?oauth=start_failed', req.url))
}
