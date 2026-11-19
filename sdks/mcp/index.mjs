#!/usr/bin/env node
/**
 * Minimal MCP stdio server for XPay (JSON-RPC + Content-Length).
 * Env: XPAY_API_KEY (required), XPAY_HUB (optional).
 */
const HUB = String(process.env.XPAY_HUB || process.env.XPAY_HUB_URL || 'https://xpay.heartbix.com/api/hub').replace(
  /\/$/,
  ''
)

function apiKey() {
  return String(process.env.XPAY_API_KEY || '').trim()
}

async function hubReq(path, init = {}) {
  const key = apiKey()
  if (!key) throw new Error('XPAY_API_KEY missing. Create a key at https://xpay.heartbix.com/account')
  const res = await fetch(`${HUB}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      'x-api-key': key,
      ...(init.headers || {})
    }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `xpay_${res.status}`)
  return data
}

const TOOLS = [
  {
    name: 'xpay_quote',
    description: 'Read the USDT price of an XPay x402 pay URL (HTTP 402 quote). Does not pay.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', description: 'Seller x402 URL, e.g. https://xpay.heartbix.com/api/pay/<alph>/price1' } }
    }
  },
  {
    name: 'xpay_pay',
    description:
      'Pay an XPay x402 URL from this XPAY_API_KEY account. Use after xpay_quote. Funds USDT from the logged-in buyer account.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', description: 'Seller x402 URL to pay' } }
    }
  },
  {
    name: 'xpay_balance',
    description: 'Show this XPay account USDT balance and Alephium pay address.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'xpay_create_endpoint',
    description: 'Seller: create a priced x402 URL. priceUsdt is catalog USDT (default 0.001).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL slug, default price1' },
        priceUsdt: { type: 'number', description: 'Catalog price in USDT, default 0.001' },
        description: { type: 'string' }
      }
    }
  }
]

async function callTool(name, args = {}) {
  if (name === 'xpay_quote') return hubReq(`/x402/pay-url?url=${encodeURIComponent(args.url || '')}`)
  if (name === 'xpay_pay') {
    return hubReq('/x402/pay-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: args.url })
    })
  }
  if (name === 'xpay_balance') {
    const me = await hubReq('/me')
    return {
      userId: me.userId,
      email: me.email,
      alphAddress: me.alphAddress,
      balanceAtomic: me.balanceAtomic,
      availableAtomic: me.availableAtomic ?? me.balanceAtomic
    }
  }
  if (name === 'xpay_create_endpoint') {
    const priceUsdt = args.priceUsdt == null ? 0.001 : Number(args.priceUsdt)
    const priceAtomic = String(Math.round(priceUsdt * 1_000_000))
    const m = await hubReq('/merchants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: args.slug || 'price1',
        priceAtomic,
        description: args.description || 'USDT micropayment via XPay x402'
      })
    })
    return {
      ...m,
      payUrl: m.resourcePath ? `https://xpay.heartbix.com${m.resourcePath}` : undefined
    }
  }
  throw new Error(`unknown_tool:${name}`)
}

function resultText(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  }
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return null
  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'xpay', version: '0.1.0' }
      }
    }
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'initialized') return null
  if (msg.method === 'ping') return { jsonrpc: '2.0', id: msg.id, result: {} }
  if (msg.method === 'tools/list') {
    return { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }
  }
  if (msg.method === 'tools/call') {
    return callTool(msg.params?.name, msg.params?.arguments || {})
      .then((value) => ({ jsonrpc: '2.0', id: msg.id, result: resultText(value) }))
      .catch((e) => ({
        jsonrpc: '2.0',
        id: msg.id,
        result: { ...resultText(e.message || String(e)), isError: true }
      }))
  }
  if (msg.id == null) return null
  return {
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` }
  }
}

function writeMessage(obj) {
  const json = JSON.stringify(obj)
  const buf = Buffer.from(json, 'utf8')
  process.stdout.write(`Content-Length: ${buf.length}\r\n\r\n`)
  process.stdout.write(buf)
}

let buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  void drain()
})

async function drain() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const len = Number(match[1])
    const start = headerEnd + 4
    if (buffer.length < start + len) return
    const body = buffer.slice(start, start + len).toString('utf8')
    buffer = buffer.slice(start + len)
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      continue
    }
    const out = handle(msg)
    if (out && typeof out.then === 'function') writeMessage(await out)
    else if (out) writeMessage(out)
  }
}

process.stdin.on('end', () => process.exit(0))
process.stdin.resume()
