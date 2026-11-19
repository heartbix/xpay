import { NextRequest, NextResponse } from 'next/server'
import { getHubBaseUrl } from '@/lib/hub'

const PROVIDERS = new Set(['google', 'github'])

export async function GET(req: NextRequest, ctx: { params: { provider: string } }) {
  const provider = ctx.params.provider
  if (!PROVIDERS.has(provider)) {
    return NextResponse.redirect(new URL('/account?oauth=unsupported_provider', req.url))
  }
  const target = `${getHubBaseUrl()}/api/auth/${provider}/callback${req.nextUrl.search}`
  const upstream = await fetch(target, { redirect: 'manual', cache: 'no-store' })
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
  return NextResponse.redirect(new URL('/account?oauth=callback_failed', req.url))
}
