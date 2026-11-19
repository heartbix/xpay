from pathlib import Path
import sys

dst = Path(sys.argv[1])
src = Path(sys.argv[2])
text = dst.read_text() if dst.exists() else ""
keys = set()
for line in text.splitlines():
    s = line.strip()
    if s and not s.startswith("#") and "=" in s:
        keys.add(s.split("=", 1)[0])
extra = []
for line in src.read_text().splitlines():
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k = s.split("=", 1)[0]
    if k not in keys:
        extra.append(s)
if extra:
    with dst.open("a", encoding="utf-8") as f:
        f.write("\n" + "\n".join(extra) + "\n")
    print("appended", len(extra))
else:
    print("already_set")
src.unlink(missing_ok=True)
