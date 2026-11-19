const DEFAULT_HUB = 'https://xpay.heartbix.com/api/hub'

function envKey() {
  return (typeof process !== 'undefined' && process.env && process.env.XPAY_API_KEY) || ''
}

function envHub() {
  return (
    (typeof process !== 'undefined' && process.env && (process.env.XPAY_HUB || process.env.XPAY_HUB_URL)) ||
    DEFAULT_HUB
  )
}

export function createClient(opts = {}) {
  const apiKey = opts.apiKey || envKey()
  const hub = String(opts.hub || envHub()).replace(/\/$/, '')

  async function hubReq(path, init = {}) {
    if (!apiKey) throw new Error('XPAY_API_KEY missing')
    const headers = {
      accept: 'application/json',
      'x-api-key': apiKey,
      ...(init.headers || {})
    }
    const res = await fetch(`${hub}${path}`, { ...init, headers })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.error || `xpay_${res.status}`)
      err.status = res.status
      err.body = data
      throw err
    }
    return data
  }

  return {
    hub,
    quote(url) {
      return hubReq(`/x402/pay-url?url=${encodeURIComponent(url)}`)
    },
    pay(url) {
      return hubReq('/x402/pay-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url })
      })
    },
    me() {
      return hubReq('/me')
    },
    createEndpoint({ slug, priceAtomic, priceUsdt, description } = {}) {
      let atomic = priceAtomic
      if (!atomic && priceUsdt != null) {
        atomic = String(Math.round(Number(priceUsdt) * 1_000_000))
      }
      return hubReq('/merchants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: slug || 'price1',
          priceAtomic: atomic || '1000',
          description: description || 'USDT micropayment via XPay x402'
        })
      })
    },
    async fetch(url, init = {}) {
      const headers = { accept: 'application/json', ...(init.headers || {}) }
      const first = await fetch(url, { ...init, headers })
      if (first.status !== 402) return first
      const paid = await this.pay(typeof url === 'string' ? url : url.toString())
      return new Response(JSON.stringify(paid), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-xpay-paid': '1' }
      })
    }
  }
}

const defaultClient = createClient()

export function xpayFetch(url, init) {
  return createClient().fetch(url, init)
}

export function quote(url) {
  return createClient().quote(url)
}

export function pay(url) {
  return createClient().pay(url)
}

export default defaultClient
