import shutil
from pathlib import Path

import pytest
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    data = tmp_path / "data"
    shutil.copytree(ROOT / "data" / "cities", data / "cities")
    shutil.copytree(ROOT / "config", tmp_path / "config")
    return data, tmp_path / "config"


def set_value(path, sheet, indicator_prefix, value):
    wb = load_workbook(path)
    ws = wb[sheet]
    for row in ws.iter_rows():
        if row[2].value and str(row[2].value).startswith(indicator_prefix):
            row[3].value = value
    wb.save(path)


def test_loader_reads_every_city(workspace):
    from app.loader import load_folder
    data, _ = workspace
    files = load_folder(data / "cities")
    assert len(files) == 8
    for f in files:
        assert len(f.records) == 202, f.city
        assert not f.warnings, f.warnings


def test_rank_label_matches_eight_city_bands():
    from app.engine import rank_label
    assert [rank_label(r, 8) for r in range(1, 9)] == [
        "Exceptional", "High", "Moderate-High", "Moderate", "Moderate", "Low-Moderate", "Low", "Low"]


def test_parse_number():
    from app.engine import parse_number
    assert parse_number("₹4,93,024") == 493024
    assert parse_number("1.60x (TomTom 2025: 60.2%)") == 1.6
    assert parse_number("N/A (not an SCM city)") is None
    assert parse_number("—") is None


def test_edit_recomputes_ratings_and_logs_history(workspace):
    from app.store import Store
    data, config = workspace
    store = Store(data, config)
    ds = store.get()
    piped = next(i for i in ds["indicators"] if i["name"].startswith("Households Connected to Piped"))
    assert piped["ratings"]["Patna"] == "Low"
    set_value(data / "cities" / "Patna_Urban_Atlas.xlsx", "Urban Infrastructure", "Households Connected to Piped", "99%")
    ds = store.get()
    piped = next(i for i in ds["indicators"] if i["name"].startswith("Households Connected to Piped"))
    assert piped["values"]["Patna"] == "99%"
    assert piped["ratings"]["Patna"] == "Exceptional"
    changes = [e for e in ds["history"] if e["type"] == "value"]
    assert changes and changes[0]["city"] == "Patna" and changes[0]["old"] == "48%"


def test_api_and_upload(workspace, monkeypatch):
    data, config = workspace
    monkeypatch.setenv("ATLAS_DATA_DIR", str(data))
    monkeypatch.setenv("ATLAS_CONFIG_DIR", str(config))
    monkeypatch.setenv("ATLAS_ADMIN_TOKEN", "secret")
    import importlib
    import app.main as main
    importlib.reload(main)
    from fastapi.testclient import TestClient
    c = TestClient(main.app)
    assert c.get("/api/health").json()["cities"] == 8
    d = c.get("/api/dashboard").json()
    assert d["cities"][0] == "Ahmedabad" and d["admin_enabled"] is True
    assert c.get("/api/cities/patna").json()["readiness"]["verdict"] == "hold"
    assert c.get("/api/export.csv").text.count("\n") == 8 * 202 + 1

    src = data / "cities" / "Kanpur_Urban_Atlas.xlsx"
    up = data.parent / "Kanpur_Urban_Atlas.xlsx"
    shutil.copy2(src, up)
    set_value(up, "Urban Infrastructure", "Households Connected to Piped", "60%")
    with up.open("rb") as fh:
        assert c.post("/api/admin/upload", files={"file": (up.name, fh)}).status_code == 401
    with up.open("rb") as fh:
        r = c.post("/api/admin/upload", files={"file": (up.name, fh)}, headers={"X-Admin-Token": "secret"})
    assert r.status_code == 200, r.text
    assert r.json()["city"] == "Kanpur" and r.json()["values_changed"] == 1
    assert (data / "backups").exists()
