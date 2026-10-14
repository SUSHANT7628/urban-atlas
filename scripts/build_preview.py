"""Build dist/preview.html: the dashboard as one static file with today's data baked in.

Useful for sharing a snapshot without running the server (uploads and live refresh are off in it).
Usage:  python scripts/build_preview.py
"""
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.store import Store  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    shutil.copytree(ROOT / "data" / "cities", Path(tmp) / "cities")
    for name in ("history.jsonl", ".snapshot.json"):
        if (ROOT / "data" / name).exists():
            shutil.copy2(ROOT / "data" / name, Path(tmp) / name)
    ds = Store(Path(tmp), ROOT / "config").get()
ds["can_write"] = False
ds["user"] = None

fe = ROOT / "frontend"
html = (fe / "index.html").read_text(encoding="utf-8")
html = html.replace('<link rel="stylesheet" href="app.css">', "<style>\n" + (fe / "app.css").read_text(encoding="utf-8") + "\n</style>")
payload = json.dumps(ds, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
scripts = "".join((fe / "js" / f).read_text(encoding="utf-8") + "\n" for f in ("util.js", "charts.js", "views.js", "app.js"))
inline = f"<script>window.__ATLAS_STATIC__={payload};</script>\n<script>\n{scripts}</script>"
html = re.sub(r'(<script src="js/[^"]+"></script>\s*)+', lambda m: inline, html, count=1)
if "--artifact" in sys.argv:
    # claude.ai artifacts supply their own document skeleton
    html = re.sub(r"<!DOCTYPE html>\s*|</?html[^>]*>\s*|</?head>\s*|</?body>\s*", "", html, flags=re.I)
    html = html.replace('<meta charset="utf-8">\n', "").replace('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n', "")
out = ROOT / "dist" / ("preview_artifact.html" if "--artifact" in sys.argv else "preview.html")
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"Wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
