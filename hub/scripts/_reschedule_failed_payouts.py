import json
from pathlib import Path

path = Path("/opt/xpay/hub/data/hub.json")
db = json.loads(path.read_text())
n = 0
for p in db.get("payouts", []):
    err = str(p.get("error") or "")
    if p.get("status") == "failed" and (
        "403 Forbidden" in err
        or "Archive requests" in err
        or "missing revert data" in err
    ):
        p["status"] = "scheduled"
        n += 1
        print(p.get("id"), p.get("chain"), p.get("amountAtomic"), p.get("netAtomic"))
path.write_text(json.dumps(db, indent=2) + "\n")
print("rescheduled", n)
