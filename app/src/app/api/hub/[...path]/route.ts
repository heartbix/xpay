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
