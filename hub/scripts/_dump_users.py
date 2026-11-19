import json

d = json.load(open("/opt/xpay/hub/data/hub.json"))
print("users", len(d.get("users", [])))
for u in d.get("users", []):
    print(repr(u.get("email")), str(u.get("id"))[:8], repr(u.get("name")))
print("---deposits---")
for x in d.get("deposits", []):
    print(
        str(x.get("userId"))[:8],
        x.get("chain"),
        x.get("token"),
        x.get("amountUsdt"),
        x.get("status"),
    )
print("---bsc---")
for a in d.get("addresses", []):
    if a.get("chain") == "bsc":
        print(str(a.get("userId"))[:8], a.get("address"))
