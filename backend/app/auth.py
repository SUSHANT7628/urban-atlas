"""Accounts, passwords and sign-in sessions.

* Users live in data/users.json with PBKDF2-SHA256 password hashes (no plain-text passwords).
* Two roles: "viewer" can read everything; "admin" can also upload, reload, remove cities and manage users.
* A session is a signed, expiring cookie (HMAC-SHA256). The signing key comes from ATLAS_SECRET_KEY
  or, if unset, a random key generated once and kept in data/.secret_key.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path

ROLES = ("viewer", "admin")
SESSION_COOKIE = "atlas_session"
SESSION_HOURS = int(os.getenv("ATLAS_SESSION_HOURS", "12"))
PBKDF2_ROUNDS = 240_000
USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,32}$")
MIN_PASSWORD = 8


class AuthError(Exception):
    pass


@dataclass
class User:
    username: str
    role: str
    name: str = ""

    def public(self) -> dict:
        return {"username": self.username, "role": self.role, "name": self.name or self.username}


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, dk = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(rounds))
        return hmac.compare_digest(test, base64.b64decode(dk))
    except (ValueError, TypeError):
        return False


class Auth:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "users.json"
        self._lock = threading.Lock()
        self._fails: dict[str, list[float]] = {}
        self.key = self._load_key(Path(data_dir))

    # ---- signing key
    @staticmethod
    def _load_key(data_dir: Path) -> bytes:
        env = os.getenv("ATLAS_SECRET_KEY")
        if env:
            return env.encode()
        p = data_dir / ".secret_key"
        if p.exists():
            return p.read_bytes()
        data_dir.mkdir(parents=True, exist_ok=True)
        key = secrets.token_hex(32).encode()
        p.write_bytes(key)
        try:
            p.chmod(0o600)
        except OSError:
            pass
        return key

    # ---- user store
    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8")).get("users", {})

    def _write(self, users: dict) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"users": users}, indent=1), encoding="utf-8")
        tmp.replace(self.path)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def list_users(self) -> list[dict]:
        return [{"username": u, "role": v["role"], "name": v.get("name", ""), "created": v.get("created")}
                for u, v in sorted(self._read().items())]

    def get(self, username: str) -> User | None:
        v = self._read().get(username.lower())
        return User(username.lower(), v["role"], v.get("name", "")) if v else None

    def add_user(self, username: str, password: str, role: str = "viewer", name: str = "", replace: bool = False) -> User:
        username = username.strip().lower()
        if not USERNAME_RE.match(username):
            raise AuthError("Usernames are 3–32 characters: letters, numbers, dot, dash or underscore.")
        if role not in ROLES:
            raise AuthError("Role must be viewer or admin.")
        if len(password) < MIN_PASSWORD:
            raise AuthError(f"Passwords need at least {MIN_PASSWORD} characters.")
        with self._lock:
            users = self._read()
            if username in users and not replace:
                raise AuthError(f"User '{username}' already exists.")
            users[username] = {"role": role, "name": name.strip(), "password": hash_password(password),
                               "created": users.get(username, {}).get("created") or time.strftime("%Y-%m-%d")}
            self._write(users)
        return User(username, role, name)

    def update_user(self, username: str, role: str | None = None, password: str | None = None, name: str | None = None) -> None:
        with self._lock:
            users = self._read()
            if username not in users:
                raise AuthError(f"No user '{username}'.")
            if role is not None:
                if role not in ROLES:
                    raise AuthError("Role must be viewer or admin.")
                if users[username]["role"] == "admin" and role != "admin" and self._admin_count(users) == 1:
                    raise AuthError("Keep at least one admin.")
                users[username]["role"] = role
            if password is not None:
                if len(password) < MIN_PASSWORD:
                    raise AuthError(f"Passwords need at least {MIN_PASSWORD} characters.")
                users[username]["password"] = hash_password(password)
            if name is not None:
                users[username]["name"] = name.strip()
            self._write(users)

    def delete_user(self, username: str) -> None:
        with self._lock:
            users = self._read()
            if username not in users:
                raise AuthError(f"No user '{username}'.")
            if users[username]["role"] == "admin" and self._admin_count(users) == 1:
                raise AuthError("Keep at least one admin.")
            del users[username]
            self._write(users)

    @staticmethod
    def _admin_count(users: dict) -> int:
        return sum(1 for v in users.values() if v["role"] == "admin")

    def ensure_bootstrap_admin(self) -> str | None:
        """Create the first admin from ATLAS_ADMIN_USER / ATLAS_ADMIN_PASSWORD when no users exist."""
        if self._read():
            return None
        user, pw = os.getenv("ATLAS_ADMIN_USER", "admin"), os.getenv("ATLAS_ADMIN_PASSWORD")
        if not pw:
            return None
        self.add_user(user, pw, "admin", "Administrator")
        return user

    # ---- sign-in
    def authenticate(self, username: str, password: str, client: str) -> User:
        now = time.time()
        recent = [t for t in self._fails.get(client, []) if now - t < 300]
        if len(recent) >= 8:
            raise AuthError("Too many failed sign-ins. Try again in a few minutes.")
        stored = self._read().get(username.strip().lower())
        ok = stored is not None and verify_password(password, stored["password"])
        if not stored:
            verify_password(password, hash_password("timing-equaliser"))  # similar response time either way
        if not ok:
            self._fails[client] = recent + [now]
            raise AuthError("Username or password is wrong.")
        self._fails.pop(client, None)
        return User(username.strip().lower(), stored["role"], stored.get("name", ""))

    # ---- session tokens
    def issue(self, user: User) -> str:
        body = base64.urlsafe_b64encode(json.dumps(
            {"u": user.username, "pv": self._pw_version(user.username),
             "exp": int(time.time()) + SESSION_HOURS * 3600}).encode()).decode().rstrip("=")
        sig = hmac.new(self.key, body.encode(), hashlib.sha256).hexdigest()
        return f"{body}.{sig}"

    def read(self, token: str | None) -> User | None:
        if not token or "." not in token:
            return None
        body, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, hmac.new(self.key, body.encode(), hashlib.sha256).hexdigest()):
            return None
        try:
            data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        except (ValueError, json.JSONDecodeError):
            return None
        if data.get("exp", 0) < time.time():
            return None
        # re-read the user so role changes, deletions and password resets apply at once
        if data.get("pv") != self._pw_version(data.get("u", "")):
            return None
        return self.get(data.get("u", ""))

    def _pw_version(self, username: str) -> str:
        stored = self._read().get(username, {}).get("password", "")
        return hashlib.sha256(stored.encode()).hexdigest()[:12] if stored else ""
