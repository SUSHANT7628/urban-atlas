# Urban Atlas

A live dashboard for comparing Indian cities on urban-planning indicators. The data lives in one Excel workbook per city; the backend reads them, rates every city against the others, and serves the dashboard. Change a workbook and the dashboard updates within seconds.

It ships with eight cities (Delhi, Kolkata, Bangalore, Ahmedabad, Pune, Jaipur, Kanpur, Patna) and 202 indicators across six themes: Economic Opportunities, Environment & Resources, Governance & Technology, Mobility & Accessibility, Social Infrastructure and Urban Infrastructure.

## What the dashboard shows

| View | What it answers |
|---|---|
| **Overview** | Who leads and trails, each city's six-theme profile, theme scores, how far apart cities are, basics vs smart technology, recent updates |
| **Compare** | Any set of cities on theme scores, a preset bundle (liveability, economy, mobility, environment, basic services) or up to 10 measures you pick |
| **City** | One city's rank on each theme, its position against the others, smart-city readiness, what to fix first, where it leads and lags |
| **Indicators** | Every value, colour-coded by rating, with a chart, sources and verification notes for each indicator |
| **Readiness** | The "basics first" gate: which cities can scale smart-city systems and which should fix water, sewerage, waste, power and drainage first, with a phased action plan |
| **Data & updates** | Workbook status, upload, reload, CSV export and the full change history |

## Run it

You need Python 3.10 or newer.

```bash
pip install -r requirements.txt
export ATLAS_ADMIN_TOKEN=pick-a-long-random-string   # Windows PowerShell: $env:ATLAS_ADMIN_TOKEN="..."
uvicorn app.main:app --app-dir backend --reload
```

```bash
git clone https://github.com/SUSHANT7628/urban-atlas.git && cd urban-atlas
pip install -r requirements.txt
python scripts/manage_users.py add admin --role admin
uvicorn app.main:app --app-dir backend or 
python -m uvicorn app.main:app --app-dir backend
```
Open <http://localhost:8000>. API docs are at <http://localhost:8000/docs>.

Or with Docker:

```bash
cp .env.example .env        # then set ATLAS_ADMIN_TOKEN in .env
docker compose up --build
```

The compose file mounts `data/` and `config/` from your machine, so edits you make there show up in the running dashboard.

## Update the data

There are three ways; all of them rebuild ratings, scores, ranks and readiness for every city.

1. **Edit the workbook.** Open `data/cities/Patna_Urban_Atlas.xlsx` (or any city), change a value in the **Value** column and save. The server checks for changed files on every request and the open dashboard checks every 15 seconds, then shows which values changed.
2. **Upload in the dashboard.** Go to *Data & updates*, drop in the workbook, enter the admin token and select **Upload and rebuild**. The previous file is kept in `data/backups/`.
3. **Use the API.**
   ```bash
   curl -X POST http://localhost:8000/api/admin/upload \
        -H "X-Admin-Token: $ATLAS_ADMIN_TOKEN" \
        -F file=@Patna_Urban_Atlas.xlsx -F city=Patna
   ```

Every change is written to `data/history.jsonl` (old value, new value, time, how it changed) and listed under *Data & updates*.

### Add a city

Copy any city workbook, rename it `<City>_Urban_Atlas.xlsx` (for example `Lucknow_Urban_Atlas.xlsx`), fill in the values and put it in `data/cities/` or upload it. Add the city's state to `config/cities.json` if you want it shown. Eight cities get distinct colours; a ninth and beyond are drawn in grey.

To remove a city, move its workbook out of `data/cities/` or call `DELETE /api/admin/cities/{city}` (it is moved to `data/backups/`).

### Workbook layout

Each city workbook has one sheet per theme (a `Summary` sheet is ignored). Each theme sheet needs a header row with at least **Indicator** and **Value**; **Topic**, **Rating**, **Data basis**, **Source & timeline** and **Verification note** are read when present. Column order doesn't matter. Keep indicator names identical across cities so they line up.

## How ratings and scores work

* **Ratings are relative.** For an indicator with a known direction (higher or lower is better), cities are ranked on their values and given one of six bands: Exceptional, High, Moderate-High, Moderate, Low-Moderate, Low. With eight cities that is ranks 1, 2, 3, 4–5, 6, 7–8; tied cities share their average rank. Change a value and the ratings move.
* **Indicators without a direction** (text values, scores the compiler judged by hand) keep the **Rating** written in the workbook. The direction for each indicator is set in `config/indicators.json`. Set `"rating_mode": "file"` there to use the workbook ratings for everything.
* **Theme score** is the city's average rating on that theme, scaled 0–100 (100 = Exceptional on every indicator). **Overall** is the same across all rated indicators.
* **Readiness** compares nine basic services against national benchmarks (MoHUA Service Level Benchmarks, SBM-U 2.0, AMRUT 2.0). Meeting all nine means a city is ready to scale smart-city systems; 7–8 means targeted use only; 4–6 means fix foundations first; 0–3 means hold new smart-city spending. Benchmarks, gate floors and actions are in `config/readiness.json`.

Most values in these workbooks are compiler estimates rather than published figures; the *Data basis* column says which. Treat ratings as a comparison between these cities, not an absolute benchmark.

## Project layout

```
backend/app/loader.py    reads the city workbooks
backend/app/engine.py    ratings, scores, ranks, readiness
backend/app/store.py     caching, change detection, history
backend/app/main.py      FastAPI routes; also serves the frontend
backend/tests/           pytest suite
frontend/                the dashboard (HTML, CSS, plain JavaScript, ECharts)
config/                  indicator directions, city metadata, readiness benchmarks
data/cities/             one workbook per city  <- the data you edit
scripts/build_preview.py builds dist/preview.html, a static snapshot of the dashboard
```

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/dashboard` | Everything the dashboard uses |
| GET | `/api/cities` | Scores and ranks for every city |
| GET | `/api/cities/{city}` | One city with all indicators and its action plan |
| GET | `/api/indicators?theme=&q=` | Indicators, filtered |
| GET | `/api/readiness` | Basic-service gate and actions |
| GET | `/api/history` | Change log |
| GET | `/api/export.csv` | Long-format export of all values |
| GET | `/api/files/{city}` | Download a city workbook |
| POST | `/api/admin/upload` | Upload a workbook (`X-Admin-Token` header) |
| POST | `/api/admin/reload` | Force a rebuild (`X-Admin-Token` header) |
| DELETE | `/api/admin/cities/{city}` | Remove a city (`X-Admin-Token` header) |

Uploads and reloads are switched off unless `ATLAS_ADMIN_TOKEN` is set.

## Deploy

Any host that runs a Docker container or a Python web process works (a small VM, Render, Railway, Fly.io). Mount or attach persistent storage at `/app/data`, otherwise uploaded workbooks and history are lost when the container restarts. Set `ATLAS_ADMIN_TOKEN` as a secret.

## Tests

```bash
pip install -r requirements-dev.txt
pytest -q
```

GitHub Actions runs the tests on every push and attaches a static `preview.html` build as an artifact.
