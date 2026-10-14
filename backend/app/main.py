"""Urban Atlas API: serves the dashboard and the data built from data/cities/*.xlsx."""
from __future__ import annotations

import csv
import io
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .loader import read_city_file
from .store import Store

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("ATLAS_DATA_DIR", ROOT / "data"))
CONFIG_DIR = Path(os.getenv("ATLAS_CONFIG_DIR", ROOT / "config"))
FRONTEND_DIR = Path(os.getenv("ATLAS_FRONTEND_DIR", ROOT / "frontend"))
ADMIN_TOKEN = os.getenv("ATLAS_ADMIN_TOKEN", "")
MAX_UPLOAD_MB = 15

store = Store(DATA_DIR, CONFIG_DIR)
app = FastAPI(title="Urban Atlas API", version="1.0.0",
              description="City-wise urban indicators, cross-city ratings and readiness, built from Excel workbooks.")
app.add_middleware(GZipMiddleware, minimum_size=2000)


def require_admin(x_admin_token: str = Header(default="")) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(503, "Updates are switched off: set ATLAS_ADMIN_TOKEN on the server to enable them.")
    if not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(401, "Admin token is missing or wrong.")


# ---------------- read API
@app.get("/api/health")
def health():
    ds = store.get()
    return {"status": "ok", "cities": len(ds["cities"]), "indicators": len(ds["indicators"]), "loaded_at": ds["meta"]["loaded_at"]}


@app.get("/api/dashboard")
def dashboard():
    """Everything the dashboard needs in one payload. Rebuilds automatically if a workbook changed."""
    ds = store.get()
    return {**ds, "admin_enabled": bool(ADMIN_TOKEN)}


@app.get("/api/cities")
def cities():
    ds = store.get()
    return [ds["city"][c] for c in ds["cities"]]


@app.get("/api/cities/{city}")
def city(city: str):
    ds = store.get()
    name = next((c for c in ds["cities"] if c.lower() == city.lower()), None)
    if not name:
        raise HTTPException(404, f"No workbook loaded for '{city}'.")
    inds = [{k: i[k] for k in ("id", "theme", "topic", "name", "direction", "basis", "rating_source")}
            | {"value": i["values"][name], "rating": i["ratings"][name], "score": i["score"][name],
               "source": i["source"][name], "note": i["note"][name]} for i in ds["indicators"]]
    return {**ds["city"][name], "readiness": ds["readiness"].get("cities", {}).get(name), "indicators": inds}


@app.get("/api/indicators")
def indicators(theme: str | None = None, q: str | None = None):
    ds = store.get()
    out = ds["indicators"]
    if theme:
        out = [i for i in out if i["theme"].lower() == theme.lower()]
    if q:
        out = [i for i in out if q.lower() in i["name"].lower()]
    return out


@app.get("/api/readiness")
def readiness():
    return store.get()["readiness"]


@app.get("/api/history")
def history(limit: int = 300):
    return store.history(limit=min(limit, 5000))


@app.get("/api/export.csv")
def export_csv():
    ds = store.get()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["city", "theme", "topic", "indicator", "value", "number", "rating", "rating_source", "score_0_100", "data_basis", "source", "note"])
    for i in ds["indicators"]:
        for c in ds["cities"]:
            w.writerow([c, i["theme"], i["topic"], i["name"], i["values"][c], i["num"][c], i["ratings"][c] or "",
                        i["rating_source"], i["score"][c], i["basis"], i["source"][c], i["note"][c]])
    buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="urban_atlas_{stamp}.csv"'})


@app.get("/api/files/{city}")
def download_city_file(city: str):
    p = store.city_path(city)
    if not p:
        raise HTTPException(404, f"No workbook loaded for '{city}'.")
    return FileResponse(p, filename=p.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------------- admin API
@app.post("/api/admin/upload", dependencies=[Depends(require_admin)])
async def upload(file: UploadFile = File(...), city: str = Form(default="")):
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an .xlsx workbook.")
    body = await file.read()
    if len(body) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp) / "upload.xlsx"
        tmp_path.write_bytes(body)
        try:
            parsed = read_city_file(tmp_path, city=city.strip() or None)
        except Exception as e:  # openpyxl raises many types for corrupt files
            raise HTTPException(400, f"Could not read the workbook: {e}") from e
        if not city.strip():
            parsed.city = re.sub(r"_?Urban_?Atlas$", "", Path(file.filename).stem, flags=re.I).replace("_", " ").strip()
        if not parsed.records:
            raise HTTPException(422, "No indicators found. Keep the city workbook layout: theme sheets with "
                                     "'Indicator' and 'Value' columns. " + " ".join(parsed.warnings[:3]))
        name = re.sub(r"[^A-Za-z0-9 ]", "", parsed.city).strip()
        if not name:
            raise HTTPException(400, "Give a city name.")
        target = store.cities_dir / f"{name.replace(' ', '_')}_Urban_Atlas.xlsx"
        existing = store.city_path(name)
        if existing and existing.exists():
            backups = DATA_DIR / "backups"
            backups.mkdir(exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
            shutil.copy2(existing, backups / f"{existing.stem}_{stamp}.xlsx")
            if existing != target:
                existing.unlink()
        shutil.copy2(tmp_path, target)
    before = {e.get("ts") for e in store.history(50)}
    ds = store.get(force=True, reason=f"upload: {file.filename}")
    changes = [e for e in ds["history"] if e.get("ts") not in before and e.get("city") == name and e["type"] == "value"]
    return {"city": name, "file": target.name, "indicators": len(parsed.records),
            "warnings": parsed.warnings, "values_changed": len(changes)}


@app.post("/api/admin/reload", dependencies=[Depends(require_admin)])
def reload():
    ds = store.get(force=True, reason="manual reload")
    return {"loaded_at": ds["meta"]["loaded_at"], "cities": ds["cities"]}


@app.delete("/api/admin/cities/{city}", dependencies=[Depends(require_admin)])
def delete_city(city: str):
    p = store.city_path(city)
    if not p:
        raise HTTPException(404, f"No workbook loaded for '{city}'.")
    backups = DATA_DIR / "backups"
    backups.mkdir(exist_ok=True)
    shutil.move(p, backups / f"{p.stem}_removed_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.xlsx")
    store.get(force=True, reason=f"removed {city}")
    return {"removed": city, "backup_folder": "data/backups"}


# ---------------- dashboard
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
