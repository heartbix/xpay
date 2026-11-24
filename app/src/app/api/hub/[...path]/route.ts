import { NextRequest, NextResponse } from 'next/server'
import { getHubBaseUrl } from '@/lib/hub'

async function proxy(req: NextRequest, params: { path: string[] }) {
  const target = `${getHubBaseUrl()}/api/${params.path.join('/')}${req.nextUrl.search}`
  const headers = new Headers()
  const auth = req.headers.get('authorization')
  const apiKey = req.headers.get('x-api-key')
  const contentType = req.headers.get('content-type')
  if (auth) headers.set('authorization', auth)
  if (apiKey) headers.set('x-api-key', apiKey)
  if (contentType) headers.set('content-type', contentType)
  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')
  if (origin) headers.set('origin', origin)
  if (referer) headers.set('referer', referer)

  // Preserve the real client IP so the hub's admin allowlist can see it.
  const forwardedFor = req.headers.get('x-forwarded-for')
  const realIp = req.headers.get('x-real-ip')
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor)
  else if (realIp) headers.set('x-forwarded-for', realIp)

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: 'no-store'
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  const upstream = await fetch(target, init)
  const text = await upstream.text()
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  })
}

type Ctx = { params: { path: string[] } }

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params)
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, ctx.params)
}
