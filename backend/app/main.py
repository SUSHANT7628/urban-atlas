"""Urban Atlas API: serves the dashboard and the data built from data/cities/*.xlsx.

Access:
  * viewer — can read everything (dashboard, API, downloads, export)
  * admin  — can also upload/reload/remove city workbooks and manage users
Sign in at POST /api/auth/login; the session is an HttpOnly cookie.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import SESSION_COOKIE, SESSION_HOURS, Auth, AuthError, User
from .loader import read_city_file
from .store import Store

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("ATLAS_DATA_DIR", ROOT / "data"))
CONFIG_DIR = Path(os.getenv("ATLAS_CONFIG_DIR", ROOT / "config"))
FRONTEND_DIR = Path(os.getenv("ATLAS_FRONTEND_DIR", ROOT / "frontend"))
PUBLIC_READ = os.getenv("ATLAS_PUBLIC_READ", "false").lower() in ("1", "true", "yes")
COOKIE_SECURE = os.getenv("ATLAS_COOKIE_SECURE", "false").lower() in ("1", "true", "yes")
MAX_UPLOAD_MB = 15
CSRF_HEADER = "x-requested-with"

log = logging.getLogger("urban_atlas")
store = Store(DATA_DIR, CONFIG_DIR)
auth = Auth(DATA_DIR)
app = FastAPI(title="Urban Atlas API", version="1.1.0",
              description="City-wise urban indicators, cross-city ratings and readiness, built from Excel workbooks. "
                          "Sign in with POST /api/auth/login; admins can change data.")
app.add_middleware(GZipMiddleware, minimum_size=2000)


@app.on_event("startup")
def bootstrap() -> None:
    created = auth.ensure_bootstrap_admin()
    if created:
        log.warning("Created admin account '%s' from ATLAS_ADMIN_PASSWORD.", created)
    elif not auth.list_users():
        log.warning("No user accounts yet. Create one: python scripts/manage_users.py add admin --role admin")


# ---------------- access control
def current_user(request: Request) -> User | None:
    return auth.read(request.cookies.get(SESSION_COOKIE))


def require_viewer(user: User | None = Depends(current_user)) -> User | None:
    if user is None and not PUBLIC_READ:
        raise HTTPException(401, "Sign in to view the dashboard.")
    return user


def require_admin(request: Request, user: User | None = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(401, "Sign in as an admin to change data.")
    if user.role != "admin":
        raise HTTPException(403, "Your account can view data but not change it. Ask an admin for write access.")
    if request.headers.get(CSRF_HEADER, "").lower() != "atlas":
        raise HTTPException(400, "Missing X-Requested-With: atlas header.")
    return user


def _set_session(resp: Response, token: str) -> None:
    resp.set_cookie(SESSION_COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True,
                    samesite="lax", secure=COOKIE_SECURE, path="/")


# ---------------- sign-in
class Login(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class NewUser(BaseModel):
    username: str
    password: str
    role: str = "viewer"
    name: str = ""


class UserUpdate(BaseModel):
    role: str | None = None
    password: str | None = None
    name: str | None = None


@app.post("/api/auth/login")
def login(body: Login, request: Request, response: Response):
    try:
        user = auth.authenticate(body.username, body.password, request.client.host if request.client else "?")
    except AuthError as e:
        raise HTTPException(401, str(e)) from e
    _set_session(response, auth.issue(user))
    return {"user": user.public()}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: User | None = Depends(current_user)):
    return {"user": user.public() if user else None, "public_read": PUBLIC_READ,
            "has_users": bool(auth.list_users())}


@app.post("/api/auth/password")
def change_password(body: PasswordChange, request: Request, response: Response, user: User | None = Depends(current_user)):
    if user is None:
        raise HTTPException(401, "Sign in first.")
    try:
        auth.authenticate(user.username, body.current_password, request.client.host if request.client else "?")
        auth.update_user(user.username, password=body.new_password)
    except AuthError as e:
        raise HTTPException(400, str(e)) from e
    _set_session(response, auth.issue(auth.get(user.username)))  # keep this browser signed in
    return {"ok": True}


# ---------------- read API (viewer or admin)
@app.get("/api/health")
def health():
    ds = store.get()
    return {"status": "ok", "cities": len(ds["cities"]), "indicators": len(ds["indicators"]), "loaded_at": ds["meta"]["loaded_at"]}


@app.get("/api/dashboard")
def dashboard(user: User | None = Depends(require_viewer)):
    """Everything the dashboard needs in one payload. Rebuilds automatically if a workbook changed."""
    ds = store.get()
    return {**ds, "user": user.public() if user else None, "can_write": bool(user and user.role == "admin")}


@app.get("/api/cities", dependencies=[Depends(require_viewer)])
def cities():
    ds = store.get()
    return [ds["city"][c] for c in ds["cities"]]


@app.get("/api/cities/{city}", dependencies=[Depends(require_viewer)])
def city(city: str):
    ds = store.get()
    name = next((c for c in ds["cities"] if c.lower() == city.lower()), None)
    if not name:
        raise HTTPException(404, f"No workbook loaded for '{city}'.")
    inds = [{k: i[k] for k in ("id", "theme", "topic", "name", "direction", "basis", "rating_source")}
            | {"value": i["values"][name], "rating": i["ratings"][name], "score": i["score"][name],
               "source": i["source"][name], "note": i["note"][name]} for i in ds["indicators"]]
    return {**ds["city"][name], "readiness": ds["readiness"].get("cities", {}).get(name), "indicators": inds}


@app.get("/api/indicators", dependencies=[Depends(require_viewer)])
def indicators(theme: str | None = None, q: str | None = None):
    out = store.get()["indicators"]
    if theme:
        out = [i for i in out if i["theme"].lower() == theme.lower()]
    if q:
        out = [i for i in out if q.lower() in i["name"].lower()]
    return out


@app.get("/api/readiness", dependencies=[Depends(require_viewer)])
def readiness():
    return store.get()["readiness"]


@app.get("/api/history", dependencies=[Depends(require_viewer)])
def history(limit: int = 300):
    return store.history(limit=min(limit, 5000))


@app.get("/api/export.csv", dependencies=[Depends(require_viewer)])
def export_csv():
    ds = store.get()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["city", "theme", "topic", "indicator", "value", "number", "rating", "rating_source", "score_0_100", "data_basis", "source", "note"])
    for i in ds["indicators"]:
        for c in ds["cities"]:
            w.writerow([c, i["theme"], i["topic"], i["name"], i["values"][c], i["num"][c], i["ratings"][c] or "",
                        i["rating_source"], i["score"][c], i["basis"], i["source"][c], i["note"][c]])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="urban_atlas_{stamp}.csv"'})


@app.get("/api/files/{city}", dependencies=[Depends(require_viewer)])
def download_city_file(city: str):
    p = store.city_path(city)
    if not p:
        raise HTTPException(404, f"No workbook loaded for '{city}'.")
    return FileResponse(p, filename=p.name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------------- write API (admin only)
@app.post("/api/admin/upload")
async def upload(file: UploadFile = File(...), city: str = Form(default=""), user: User = Depends(require_admin)):
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
            shutil.copy2(existing, backups / f"{existing.stem}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.xlsx")
            if existing != target:
                existing.unlink()
        shutil.copy2(tmp_path, target)
    before = {e.get("ts") for e in store.history(50)}
    ds = store.get(force=True, reason=f"upload by {user.username}: {file.filename}")
    changes = [e for e in ds["history"] if e.get("ts") not in before and e.get("city") == name and e["type"] == "value"]
    return {"city": name, "file": target.name, "indicators": len(parsed.records),
            "warnings": parsed.warnings, "values_changed": len(changes)}


@app.post("/api/admin/reload")
def reload(user: User = Depends(require_admin)):
    ds = store.get(force=True, reason=f"reload by {user.username}")
    return {"loaded_at": ds["meta"]["loaded_at"], "cities": ds["cities"]}


@app.delete("/api/admin/cities/{city}")
def delete_city(city: str, user: User = Depends(require_admin)):
    p = store.city_path(city)
    if not p:
        raise HTTPException(404, f"No workbook loaded for '{city}'.")
    backups = DATA_DIR / "backups"
    backups.mkdir(exist_ok=True)
    shutil.move(p, backups / f"{p.stem}_removed_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.xlsx")
    store.get(force=True, reason=f"{city} removed by {user.username}")
    return {"removed": city, "backup_folder": "data/backups"}


@app.get("/api/admin/users", dependencies=[Depends(require_admin)])
def list_users():
    return auth.list_users()


@app.post("/api/admin/users", dependencies=[Depends(require_admin)])
def create_user(body: NewUser):
    try:
        return auth.add_user(body.username, body.password, body.role, body.name).public()
    except AuthError as e:
        raise HTTPException(400, str(e)) from e


@app.patch("/api/admin/users/{username}", dependencies=[Depends(require_admin)])
def edit_user(username: str, body: UserUpdate):
    try:
        auth.update_user(username.lower(), role=body.role, password=body.password, name=body.name)
    except AuthError as e:
        raise HTTPException(400, str(e)) from e
    return auth.get(username.lower()).public()


@app.delete("/api/admin/users/{username}")
def remove_user(username: str, user: User = Depends(require_admin)):
    if username.lower() == user.username:
        raise HTTPException(400, "You can't remove your own account while signed in to it.")
    try:
        auth.delete_user(username.lower())
    except AuthError as e:
        raise HTTPException(400, str(e)) from e
    return {"removed": username.lower()}


# ---------------- dashboard
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
