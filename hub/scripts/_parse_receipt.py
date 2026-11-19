import json
import urllib.request

req = urllib.request.Request(
    "https://bsc-dataseed.binance.org",
    data=open("/tmp/_rpc_receipt.json", "rb").read(),
    headers={"Content-Type": "application/json"},
)
raw = urllib.request.urlopen(req, timeout=20).read()
body = json.loads(raw)
r = body["result"]
gu = int(r["gasUsed"], 16)
gp = int(r.get("effectiveGasPrice") or r.get("gasPrice") or "0x0", 16)
print("status", r.get("status"))
print("gasUsed", gu)
print("gasPrice", gp)
print("feeWei", gu * gp)
print("feeBNB", gu * gp / 1e18)
