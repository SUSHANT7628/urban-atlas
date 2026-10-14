"""Turn loaded city files into the dashboard dataset: ratings, scores, ranks, readiness."""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

from .loader import RATING_LABELS, CityFile

RATING_SCORE = {lab: 6 - i for i, lab in enumerate(RATING_LABELS)}  # Exceptional 6 ... Low 1


def parse_number(value: str) -> float | None:
    """First number in a cell, ignoring thousands separators. 'N/A', '—' and text give None."""
    s = str(value or "").replace(",", "").strip()
    if s in ("", "—", "-", "–") or s.lower().startswith(("n/a", "not ")):
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def slug(*parts: str) -> str:
    s = "-".join(parts).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:90]


def rank_label(avg_rank: float, n: int) -> str:
    """Map a 1-based rank among n cities to one of the six rating bands (8 cities: 1,2,3,4-5,6,7-8)."""
    if n <= 1:
        return "Moderate"
    r = math.floor(avg_rank + 0.5)
    pos = (r - 1) / (n - 1)
    eps = 1e-9
    for limit, lab in ((0, "Exceptional"), (1 / 7, "High"), (2 / 7, "Moderate-High"), (4 / 7, "Moderate"), (5 / 7, "Low-Moderate")):
        if pos <= limit + eps:
            return lab
    return "Low"


def rating_score(label: str | None) -> float | None:
    s = RATING_SCORE.get(label or "")
    return None if s is None else (s - 1) / 5 * 100


def build_dataset(files: list[CityFile], directions: dict, city_meta: dict, readiness_cfg: dict,
                  rating_mode: str = "recompute") -> dict:
    cities = [f.city for f in files]
    themes: list[str] = []
    indicators: dict[str, dict] = {}
    for f in files:
        for rec in f.records:
            if rec.theme not in themes:
                themes.append(rec.theme)
            ind = indicators.setdefault(rec.key, {
                "id": slug(rec.theme, rec.topic, rec.indicator), "key": rec.key,
                "theme": rec.theme, "topic": rec.topic, "name": rec.indicator,
                "values": {}, "num": {}, "file_ratings": {}, "basis": {}, "source": {}, "note": {},
            })
            ind["values"][f.city] = rec.value
            ind["num"][f.city] = parse_number(rec.value)
            ind["file_ratings"][f.city] = rec.rating
            ind["basis"][f.city] = rec.basis
            ind["source"][f.city] = rec.source
            ind["note"][f.city] = rec.note

    out_inds = []
    for ind in indicators.values():
        direction = directions.get(ind["key"], "none")
        nums = {c: v for c, v in ind["num"].items() if v is not None}
        recompute = rating_mode != "file" and direction in ("higher", "lower") and len(nums) >= 3 and len(set(nums.values())) > 1
        ratings: dict[str, str | None] = {}
        if recompute:
            n = len(nums)
            for c in cities:
                v = nums.get(c)
                if v is None:
                    ratings[c] = ind["file_ratings"].get(c)  # e.g. "Not yet published": keep what the file says
                    continue
                better = sum(1 for o in nums.values() if (o > v if direction == "higher" else o < v))
                equal = sum(1 for o in nums.values() if o == v)
                ratings[c] = rank_label(better + (equal + 1) / 2, n)
        else:
            ratings = {c: ind["file_ratings"].get(c) for c in cities}
        lo, hi = (min(nums.values()), max(nums.values())) if nums else (None, None)
        score = {}
        for c in cities:
            v = nums.get(c)
            if recompute and v is not None and hi > lo:
                x = (v - lo) / (hi - lo)
                score[c] = round(100 * (x if direction == "higher" else 1 - x), 1)
            else:
                score[c] = rating_score(ratings.get(c))
        basis = Counter(b for b in ind["basis"].values() if b).most_common(1)
        out_inds.append({
            "id": ind["id"], "theme": ind["theme"], "topic": ind["topic"], "name": ind["name"],
            "direction": direction,
            "rating_source": "computed" if recompute else "file",
            "basis": basis[0][0] if basis else "",
            "values": {c: ind["values"].get(c, "") for c in cities},
            "num": {c: ind["num"].get(c) for c in cities},
            "ratings": ratings, "score": score,
            "source": {c: ind["source"].get(c, "") for c in cities},
            "note": {c: ind["note"].get(c, "") for c in cities},
            "rated": any(ratings.values()),
        })

    # ---- city scores
    city_out = {}
    for c in cities:
        th = {}
        for t in themes:
            s = [rating_score(i["ratings"].get(c)) for i in out_inds if i["theme"] == t]
            s = [x for x in s if x is not None]
            th[t] = round(sum(s) / len(s), 1) if s else None
        alls = [rating_score(i["ratings"].get(c)) for i in out_inds]
        alls = [x for x in alls if x is not None]
        counts = Counter(i["ratings"].get(c) for i in out_inds if i["ratings"].get(c))
        city_out[c] = {
            "name": c, "state": city_meta.get(c, {}).get("state", ""),
            "overall": round(sum(alls) / len(alls), 1) if alls else None,
            "themes": th, "counts": {lab: counts.get(lab, 0) for lab in RATING_LABELS},
            "rated": len(alls), "indicators": sum(1 for i in out_inds if i["values"].get(c)),
        }
    order = sorted(cities, key=lambda c: -(city_out[c]["overall"] or -1))
    for k, c in enumerate(order):
        city_out[c]["rank"] = k + 1
    for t in themes:
        o = sorted(cities, key=lambda c: -(city_out[c]["themes"][t] if city_out[c]["themes"][t] is not None else -1))
        for k, c in enumerate(o):
            city_out[c].setdefault("theme_rank", {})[t] = k + 1

    return {
        "cities": order, "themes": themes, "rating_labels": RATING_LABELS,
        "city": city_out, "indicators": out_inds,
        "readiness": build_readiness(out_inds, cities, readiness_cfg),
    }


def _find(inds: list[dict], match: str) -> dict | None:
    for i in inds:
        if i["name"].startswith(match):
            return i
    for i in inds:
        if match in i["name"]:
            return i
    return None


def build_readiness(inds: list[dict], cities: list[str], cfg: dict) -> dict:
    if not cfg:
        return {}
    bench = []
    for b in cfg.get("benchmarks", []):
        ind = _find(inds, b["match"])
        if ind:
            bench.append({**b, "indicator_id": ind["id"], "indicator": ind["name"]})
    smart = []
    for s in cfg.get("smart_tech", []):
        ind = _find(inds, s["match"])
        if ind:
            smart.append({**s, "indicator_id": ind["id"], "indicator": ind["name"]})
    by_id = {i["id"]: i for i in inds}

    def score(b, c):
        v = by_id[b["indicator_id"]]["num"].get(c)
        if v is None:
            return None
        x = (v - b["zero_at"]) / (b["benchmark"] - b["zero_at"])
        return round(max(0.0, min(1.0, x)) * 100, 1)

    def passes(b, c):
        v = by_id[b["indicator_id"]]["num"].get(c)
        if v is None or b.get("gate_floor") is None:
            return None
        return v >= b["gate_floor"] if b["benchmark"] > b["zero_at"] else v <= b["gate_floor"]

    def avg(xs):
        xs = [x for x in xs if x is not None]
        return round(sum(xs) / len(xs), 1) if xs else None

    out = {}
    for c in cities:
        gate = [b for b in bench if b.get("gate_floor") is not None]
        checks = [{"indicator_id": b["indicator_id"], "label": b["label"], "passed": passes(b, c)} for b in gate]
        passed = sum(1 for x in checks if x["passed"])
        phase = defaultdict(list)
        for b in bench:
            phase[b["phase"]].append(score(b, c))
        smart_v = avg([by_id[s["indicator_id"]]["num"].get(c) for s in smart])
        found = avg(phase[1])
        if passed == len(gate):
            verdict = "ready"
        elif passed >= cfg.get("gate_targeted", 7):
            verdict = "targeted"
        elif passed >= cfg.get("gate_fix", 4):
            verdict = "fix"
        else:
            verdict = "hold"
        actions = []
        for b in bench:
            s = score(b, c)
            if s is None:
                continue
            actions.append({"phase": b["phase"], "label": b["label"], "action": b["action"], "scheme": b["scheme"],
                            "indicator_id": b["indicator_id"], "now": by_id[b["indicator_id"]]["values"].get(c),
                            "target": f'{b["benchmark"]}{b["unit"]}', "score": s, "gate": passes(b, c)})
        actions.sort(key=lambda a: (a["phase"], a["score"]))
        out[c] = {"passed": passed, "total": len(gate), "checks": checks, "foundation": found,
                  "phase2": avg(phase[2]), "phase3": avg(phase[3]), "smart": smart_v,
                  "gap": None if smart_v is None or found is None else round(smart_v - found, 1),
                  "verdict": verdict, "actions": actions}
    return {"benchmarks": bench, "smart_tech": smart, "cities": out}
