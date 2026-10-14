"""Keeps the dataset in memory and rebuilds it whenever a city workbook changes.

Every rebuild is compared with the previous snapshot; changed values are appended to
data/history.jsonl so the dashboard can show what changed and when.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from .engine import build_dataset
from .loader import load_folder


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, data_dir: Path, config_dir: Path):
        self.data_dir = Path(data_dir)
        self.cities_dir = self.data_dir / "cities"
        self.config_dir = Path(config_dir)
        self.history_path = self.data_dir / "history.jsonl"
        self.snapshot_path = self.data_dir / ".snapshot.json"
        self.cities_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._fingerprint = None
        self._dataset: dict | None = None
        self._files: list = []
        self.loaded_at: str | None = None

    # ---- config
    def _config(self, name: str, key: str) -> dict:
        p = self.config_dir / name
        if not p.exists():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
        return data.get(key, data) if key else data

    def fingerprint(self) -> tuple:
        parts = []
        for p in sorted(self.cities_dir.glob("*.xlsx")):
            if p.name.startswith(("~$", ".")):
                continue
            st = p.stat()
            parts.append((p.name, st.st_mtime_ns, st.st_size))
        for p in sorted(self.config_dir.glob("*.json")):
            parts.append((p.name, p.stat().st_mtime_ns))
        return tuple(parts)

    # ---- load
    def get(self, force: bool = False, reason: str = "file change") -> dict:
        fp = self.fingerprint()
        if not force and self._dataset is not None and fp == self._fingerprint:
            return self._dataset
        with self._lock:
            fp = self.fingerprint()
            if not force and self._dataset is not None and fp == self._fingerprint:
                return self._dataset
            files = load_folder(self.cities_dir)
            ds = build_dataset(
                files,
                directions=self._config("indicators.json", "directions"),
                city_meta=self._config("cities.json", "cities"),
                readiness_cfg=self._config("readiness.json", None),
                rating_mode=self._config("indicators.json", None).get("rating_mode", "recompute"),
            )
            self.loaded_at = _now()
            ds["meta"] = {
                "loaded_at": self.loaded_at,
                "files": [{
                    "city": f.city, "file": f.path.name,
                    "modified": datetime.fromtimestamp(f.path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"),
                    "records": len(f.records), "warnings": f.warnings,
                } for f in files],
            }
            meta_order = list(self._config("cities.json", "cities").keys())
            ds["city_order"] = [c for c in meta_order if c in ds["cities"]] + sorted(c for c in ds["cities"] if c not in meta_order)
            self._record_history(ds, reason)
            ds["history"] = self.history(limit=300)
            self._dataset, self._fingerprint, self._files = ds, fp, files
            return ds

    # ---- history
    def _record_history(self, ds: dict, reason: str) -> None:
        snap = {c: {i["id"]: i["values"].get(c, "") for i in ds["indicators"]} for c in ds["cities"]}
        names = {i["id"]: (i["theme"], i["name"]) for i in ds["indicators"]}
        prev = None
        if self.snapshot_path.exists():
            try:
                prev = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                prev = None
        events = []
        ts = _now()
        if prev is None:
            events.append({"ts": ts, "type": "baseline", "reason": reason,
                           "text": f"Baseline loaded: {len(snap)} cities, {len(ds['indicators'])} indicators."})
        else:
            for c in snap:
                if c not in prev:
                    events.append({"ts": ts, "type": "city_added", "city": c, "reason": reason, "text": f"{c} added."})
                    continue
                for iid, v in snap[c].items():
                    old = prev[c].get(iid)
                    if old is not None and old != v:
                        th, nm = names[iid]
                        events.append({"ts": ts, "type": "value", "city": c, "theme": th, "indicator": nm,
                                       "indicator_id": iid, "old": old, "new": v, "reason": reason})
            for c in prev:
                if c not in snap:
                    events.append({"ts": ts, "type": "city_removed", "city": c, "reason": reason, "text": f"{c} removed."})
        if events:
            with self.history_path.open("a", encoding="utf-8") as fh:
                for e in events:
                    fh.write(json.dumps(e, ensure_ascii=False) + "\n")
        self.snapshot_path.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")

    def history(self, limit: int = 300) -> list[dict]:
        if not self.history_path.exists():
            return []
        lines = self.history_path.read_text(encoding="utf-8").splitlines()
        out = []
        for ln in reversed(lines[-limit:]):
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
        return out

    def city_path(self, city: str) -> Path | None:
        self.get()
        for f in self._files:
            if f.city.lower() == city.lower():
                return f.path
        return None
