# xpay-client

Zero-dependency XPay client. HTTP 402 is price discovery. This package pays it with your XPay API key.

```python
from xpay_client import xpay_get
paid = xpay_get("https://xpay.heartbix.com/api/pay/<seller-alph>/price1")
print(paid.json()["txId"])
```

Set `XPAY_API_KEY=ak_live_…` (create a key at https://xpay.heartbix.com/account). Fund USDT first.

```
pip install xpay-client
```

Docs: https://xpay.heartbix.com/llms.txt
