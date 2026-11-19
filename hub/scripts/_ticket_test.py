import json
import urllib.error
import urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:43142/api/tickets",
    data=json.dumps(
        {
            "kind": "issue",
            "email": "bourmatt@gmail.com",
            "name": "SMTP test",
            "message": "Testing XPay ticket SMTP from hub.",
        }
    ).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    print(urllib.request.urlopen(req, timeout=25).read().decode())
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode())
