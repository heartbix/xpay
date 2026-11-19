import json

want = "0xcd08af41185e219ae9b9ba657d550db224b04bbd85a26dbb88341a35a2a3d42c"
d = json.load(open("/opt/xpay/hub/data/hub.json"))
print("---payouts matching---")
for p in d.get("payouts", []):
    blob = json.dumps(p).lower()
    if want[2:] in blob or want.lower() in blob:
        for k in [
            "id",
            "userId",
            "chain",
            "token",
            "toAddress",
            "amountAtomic",
            "feeAtomic",
            "netAtomic",
            "status",
            "error",
            "txHash",
            "costUsdtAtomic",
            "createdAt",
            "updatedAt",
        ]:
            print(f"{k}={p.get(k)}")
        print("---")
print("---latest payouts---")
for p in sorted(d.get("payouts", []), key=lambda x: x.get("createdAt") or "", reverse=True)[:8]:
    print(
        p.get("createdAt"),
        p.get("status"),
        p.get("chain"),
        p.get("amountAtomic"),
        p.get("netAtomic"),
        p.get("txHash"),
        str(p.get("error") or "")[:160],
    )
