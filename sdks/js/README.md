# @heartbix/xpay

Zero-dependency XPay client. HTTP 402 is price discovery. This package pays it with your XPay API key.

```js
import { xpayFetch } from '@heartbix/xpay'
const paid = await xpayFetch('https://xpay.heartbix.com/api/pay/<seller-alph>/price1')
```

Set `XPAY_API_KEY=ak_live_…` (create a key at https://xpay.heartbix.com/account). Fund USDT first.

Docs: https://xpay.heartbix.com/llms.txt
