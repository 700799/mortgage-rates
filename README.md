# mortgage-rates

A single-page dashboard of daily U.S. mortgage rates, hosted on GitHub Pages.

- **Multi-source rate table** — Freddie Mac PMMS, Optimal Blue OBMMI, Mortgage News Daily, Bankrate
- **Interactive financial chart** — TradingView Lightweight Charts with crosshair, zoom/pan, multi-series toggle, area fill, log scale
- **Pill range toggle** — 1D · 1W · 1M · 3M · 6M · 1Y · 3Y · 5Y filters the chart and trend sparklines
- **Driver rates** — 10Y/30Y Treasury, Fed Funds, SOFR, MBS spread
- **Macro context** — S&P 500, CPI, Core PCE, unemployment, GDP, housing starts/sales
- **Key indicators** — Yield curve, dollar index, VIX, consumer sentiment, M2
- **Daily news feed** — RSS roll-up, paginated, rolling 10-day window
- **Daily digest signup** — Email/SMS form posting to Formspree

## How it works

```
GitHub Actions (daily 11:00 UTC) → fetch_data.py → FRED API + RSS feeds → /data/*.json (committed) → GitHub Pages serves the SPA
```

The SPA itself is a single `index.html` + one CSS + one JS module. No build step. Everything ships from the repo.

## Setup (one-time)

### 1. FRED API key

Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html, then add it as a repository secret:

```
Settings → Secrets and variables → Actions → New repository secret
Name:  FRED_API_KEY
Value: <your key>
```

### 2. Formspree endpoint (for alert form)

Create a free form at https://formspree.io, then paste the endpoint URL into `config.js`:

```js
window.FORMSPREE_ENDPOINT = "https://formspree.io/f/yourFormId";
```

Without this, the form will reject submissions with a clear message — no errors thrown.

### 3. Enable GitHub Pages

```
Settings → Pages → Build and deployment
  Source: GitHub Actions
```

Push to `main` and the `Deploy to GitHub Pages` workflow publishes to `https://<user>.github.io/mortgage-rates/`.

### 4. Trigger the first data refresh

The cron runs daily at 11:00 UTC. To populate data immediately:

```
Actions → Daily data refresh → Run workflow
```

The repo ships with bootstrap synthetic data in `data/*.json` so the page renders before the first cron run; the first real run overwrites it.

## Local development

```bash
# regenerate bootstrap data (offline, no API key needed)
python scripts/fetch_data.py --bootstrap

# serve locally
python -m http.server 8000
# open http://localhost:8000
```

## Architecture

| File | Role |
|---|---|
| `index.html` | SPA shell, semantic markup for every section |
| `assets/styles.css` | Layout, pill toggle, tables, cards, light/dark theme via `prefers-color-scheme` |
| `assets/app.js` | Data fetch, render, Lightweight Charts setup, pill/form/news interactions |
| `config.js` | Formspree endpoint (per-deployment) |
| `scripts/fetch_data.py` | FRED + RSS fetcher; production and `--bootstrap` modes |
| `.github/workflows/daily-update.yml` | Cron job that refreshes `/data` |
| `.github/workflows/pages.yml` | Pages deploy on push to `main` |
| `data/series.json` | All series history + pre-shaped rate table |
| `data/news.json` | Rolling 10-day window of articles |
| `data/meta.json` | Last-updated timestamp, fetch status, stale flag |

## Data sources

- **Mortgage rates:** Freddie Mac PMMS (weekly) and Optimal Blue OBMMI (daily) via FRED. Mortgage News Daily and Bankrate columns are synthesized from OBMMI with documented offsets until you wire in their own feeds.
- **Treasury yields, Fed funds, SOFR:** FRED daily series.
- **Macro indicators (CPI, PCE, GDP, etc.):** FRED. Year-over-year transforms computed in `fetch_data.py`.
- **News:** RSS feeds from Mortgage News Daily, HousingWire, Federal Reserve, MarketWatch, CNBC.

## Not financial advice

Rates shown are surveys/averages and do not reflect lender-specific quotes. The dashboard is informational.
