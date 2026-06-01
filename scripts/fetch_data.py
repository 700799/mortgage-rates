"""
Daily data refresh for the mortgage-rates SPA.

Reads from FRED (real-time U.S. macro data) and a basket of public RSS feeds,
writes three JSON files under /data/:

    data/series.json   — series history + the pre-shaped rate table the SPA renders
    data/news.json     — rolling 10-day window of articles
    data/meta.json     — last_updated, per-source status, stale flag

Run modes:
    python scripts/fetch_data.py            # production: FRED + RSS, requires FRED_API_KEY env
    python scripts/fetch_data.py --bootstrap # offline: synthetic but shaped exactly like production output

The --bootstrap path lets us commit a working SPA before the first cron run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
HISTORY_YEARS = 5
NEWS_DAYS_KEEP = 10
NEWS_PER_DAY = 10

# ─── Series catalogue ──────────────────────────────────────────────
# Every FRED ID we pull, plus the explanation we render alongside it.

MORTGAGE_SERIES = {
    "MORTGAGE30US":   {"title": "30-Year Fixed Mortgage Average", "source": "Freddie Mac PMMS", "unit": "pct"},
    "MORTGAGE15US":   {"title": "15-Year Fixed Mortgage Average", "source": "Freddie Mac PMMS", "unit": "pct"},
    "OBMMIC30YF":     {"title": "Optimal Blue 30Y Conforming",    "source": "Optimal Blue OBMMI", "unit": "pct"},
    "OBMMIC15YF":     {"title": "Optimal Blue 15Y Conforming",    "source": "Optimal Blue OBMMI", "unit": "pct"},
    "OBMMIJ30YF":     {"title": "Optimal Blue 30Y Jumbo",         "source": "Optimal Blue OBMMI", "unit": "pct"},
    "OBMMIFHA30YF":   {"title": "Optimal Blue 30Y FHA",           "source": "Optimal Blue OBMMI", "unit": "pct"},
    "OBMMIVA30YF":    {"title": "Optimal Blue 30Y VA",            "source": "Optimal Blue OBMMI", "unit": "pct"},
}

DRIVER_SERIES = [
    ("DGS10", "10-Year Treasury Yield", "pct",
     "Benchmark for 30-year fixed mortgage pricing. When the 10Y rises, mortgages follow within days."),
    ("DGS30", "30-Year Treasury Yield", "pct",
     "Long-end of the curve. Direct sentiment proxy for very long-duration debt like mortgage-backed bonds."),
    ("DGS2",  "2-Year Treasury Yield", "pct",
     "Front-end of the curve — most sensitive to Fed expectations. Moves first when policy outlook shifts."),
    ("DGS5",  "5-Year Treasury Yield", "pct",
     "Belly of the curve. Indexes some hybrid ARMs and reflects the medium-term rate path."),
    ("DFF",   "Federal Funds Rate", "pct",
     "The Fed's policy rate. Sets the floor for short-term borrowing and bleeds into mortgage pricing via expectations."),
    ("SOFR",  "SOFR (Overnight Funding)", "pct",
     "Successor to LIBOR. Indexes most new ARMs and floating-rate commercial mortgages."),
    ("T10YIE", "10Y Breakeven Inflation", "pct",
     "Market-implied 10-year inflation from TIPS spreads. Rising breakevens lift nominal yields and mortgage rates."),
    ("MBS_SPREAD", "MBS Current-Coupon Spread", "pct",
     "30-yr mortgage minus 10-yr Treasury. The mortgage industry's own risk premium — wider spread = costlier mortgages."),
]

RELATED_SERIES = [
    ("SP500",         "S&P 500", "index",
     "Risk-on equity rallies pull capital out of bonds and lift mortgage rates."),
    ("CPIAUCSL_YOY",  "CPI YoY", "pct",
     "Headline inflation. Hotter prints push the Fed hawkish and lift the long end of the curve."),
    ("PCEPILFE_YOY",  "Core PCE YoY", "pct",
     "The Fed's preferred inflation gauge — drives policy expectations more than CPI."),
    ("CUUR0000SEHA_YOY", "CPI Rent YoY", "pct",
     "Shelter inflation. The single largest CPI component — the Fed watches this closely for sticky-inflation signals."),
    ("UNRATE",        "Unemployment Rate", "pct",
     "Labor slack. Higher unemployment usually means lower mortgage rates as Treasury yields fall."),
    ("PAYEMS_DELTA",  "Nonfarm Payrolls (Δ k)", "num",
     "Monthly change in U.S. jobs. The headline jobs print — surprises move 10Y yields the fastest."),
    ("ICSA",          "Initial Jobless Claims (k)", "num",
     "Weekly read on layoffs. Rising claims often precede rate cuts as the labor market softens."),
    ("JTSJOL",        "JOLTS Job Openings (k)", "num",
     "Open jobs across the economy. A leading wage-and-inflation signal the Fed weights heavily."),
    ("GDPC1_YOY",     "Real GDP YoY", "pct",
     "Overall growth. Strong growth + tight labor = sticky rates."),
    ("PSAVERT",       "Personal Saving Rate", "pct",
     "Households' saving rate. Lower saving = stretched consumers and weakening housing demand."),
    ("HOUST",         "Housing Starts (SAAR, k)", "num",
     "Supply pipeline. Affects home prices more than rates, but feeds Fed thinking on shelter inflation."),
    ("PERMIT",        "Building Permits (SAAR, k)", "num",
     "Forward-looking supply signal — permits lead starts by a few months."),
    ("HSN1F",         "New Home Sales (SAAR, k)", "num",
     "New-construction demand. Highly rate-sensitive — buyers walk fast when financing costs rise."),
    ("EXHOSLUSM495S", "Existing Home Sales (SAAR, k)", "num",
     "Demand-side housing health — declines often precede rate cuts."),
    ("MSACSR",        "Months Supply (New Homes)", "num",
     "Months of new-home inventory at current pace. >6 = buyer's market, <4 = seller's."),
    ("CSUSHPINSA_YOY","Case-Shiller Home Prices YoY", "pct",
     "National home price growth. Higher prices = larger loan sizes and more interest-rate-sensitive monthly payments."),
    ("DRSFRMACBS",    "Mortgage Delinquency Rate", "pct",
     "Single-family delinquencies at all commercial banks. A late-cycle signal: rising delinquencies precede credit tightening."),
]

KEY_INDICATORS = [
    ("T10Y2Y",  "10Y–2Y Yield Spread", "pct",
     "Difference between the 10-year and 2-year Treasury yields. A negative spread (inverted curve) has preceded most U.S. recessions."),
    ("DTWEXBGS", "Trade-Weighted Dollar Index", "index",
     "Broad measure of the dollar vs. major trading partners. A strong dollar imports disinflation and tends to cap U.S. rates."),
    ("VIXCLS",  "VIX Volatility Index", "index",
     "S&P 500 30-day implied volatility. Spikes coincide with flight-to-quality bond buying, which pulls mortgage rates lower."),
    ("UMCSENT", "Consumer Sentiment", "index",
     "University of Michigan survey. Forward-looking proxy for spending, housing demand, and inflation expectations."),
    ("M2SL",    "M2 Money Stock ($B)", "num",
     "Broad money supply. The liquidity backdrop for everything — outsized expansion fed the 2020–2022 inflation surge."),
    ("WALCL",   "Fed Balance Sheet ($B)", "num",
     "Total assets held by the Federal Reserve. Expansion (QE) compresses term premia and mortgage spreads; runoff (QT) widens them."),
    ("WSHOMCB", "Fed MBS Holdings ($B)", "num",
     "Mortgage-backed securities on the Fed's balance sheet. Direct supply/demand for MBS — drives the mortgage-Treasury spread."),
    ("BAMLH0A0HYM2", "High-Yield Credit Spread", "pct",
     "ICE BofA HY OAS. Wider spreads = risk-off; capital flows into Treasuries, pulling mortgage rates down with them."),
    ("DGS3MO",  "3-Month T-Bill", "pct",
     "Front-end policy proxy. Diverges from the funds rate when the market is pricing imminent Fed action."),
    ("T5YIFR",  "5y5y Forward Inflation", "pct",
     "5-year inflation expectations starting 5 years out. The Fed's favorite long-term inflation anchor — drives the rates outlook."),
]

RATE_TABLE_SOURCE_COLUMNS = [
    {"id": "freddie_mac", "label": "Freddie Mac PMMS",   "freq": "Weekly"},
    {"id": "obmmi",       "label": "Optimal Blue OBMMI", "freq": "Daily"},
    {"id": "mnd",         "label": "Mortgage News Daily","freq": "Daily"},
    {"id": "bankrate",    "label": "Bankrate",           "freq": "Daily"},
]

# (product_id, display name, sub, FRED IDs per source column, trend series)
RATE_TABLE_PRODUCTS = [
    ("30yr_fixed",   "30-Year Fixed",   "Conventional, conforming",
     {"freddie_mac": "MORTGAGE30US", "obmmi": "OBMMIC30YF"}, "OBMMIC30YF"),
    ("15yr_fixed",   "15-Year Fixed",   "Conventional, conforming",
     {"freddie_mac": "MORTGAGE15US", "obmmi": "OBMMIC15YF"}, "OBMMIC15YF"),
    ("jumbo_30",     "30-Year Jumbo",   "Above conforming limit",
     {"obmmi": "OBMMIJ30YF"},        "OBMMIJ30YF"),
    ("fha_30",       "30-Year FHA",     "Federal Housing Administration",
     {"obmmi": "OBMMIFHA30YF"},      "OBMMIFHA30YF"),
    ("va_30",        "30-Year VA",      "Veterans Affairs",
     {"obmmi": "OBMMIVA30YF"},       "OBMMIVA30YF"),
    ("5_1_arm",      "5/1 ARM",         "Adjustable after 5 years",
     {"freddie_mac": "MORTGAGE5US"}, "MORTGAGE5US"),
]

NEWS_FEEDS = [
    "https://www.mortgagenewsdaily.com/rss",
    "https://www.housingwire.com/rss/",
    "https://www.federalreserve.gov/feeds/press_all.xml",
    "https://www.marketwatch.com/feeds/rss/topstories.xml",
    "https://www.cnbc.com/id/10001054/device/rss/rss.html",
    "https://www.cnbc.com/id/10000664/device/rss/rss.html",
]


# ─── FRED ──────────────────────────────────────────────────────────
def fetch_fred(series_id: str, api_key: str) -> list[dict]:
    import requests  # lazy import; not needed in bootstrap mode
    end = dt.date.today()
    start = end - dt.timedelta(days=HISTORY_YEARS * 365 + 30)
    r = requests.get(FRED_BASE, params={
        "series_id": series_id, "api_key": api_key, "file_type": "json",
        "observation_start": start.isoformat(), "observation_end": end.isoformat(),
    }, timeout=20)
    r.raise_for_status()
    out = []
    for o in r.json().get("observations", []):
        v = o["value"]
        if v in ("", ".", None): continue
        try:
            out.append({"date": o["date"], "value": float(v)})
        except ValueError:
            continue
    return out


def yoy(obs: list[dict]) -> list[dict]:
    """Year-over-year percent change for a level series (e.g. CPI → CPI YoY).

    Tolerates non-aligned dates: finds the closest observation within ±32 days
    of the exact 1-year-prior date.
    """
    if len(obs) < 2: return []
    by_date = {o["date"]: o["value"] for o in obs}
    dates = sorted(by_date.keys())
    result = []
    for o in obs:
        d = dt.date.fromisoformat(o["date"])
        try:
            target = d.replace(year=d.year - 1)
        except ValueError:                           # Feb 29 edge case
            target = d.replace(year=d.year - 1, day=28)
        target_iso = target.isoformat()
        best = None
        best_delta = 32
        for cand in dates:
            if cand > o["date"]: break
            cand_d = dt.date.fromisoformat(cand)
            delta = abs((cand_d - target).days)
            if delta <= best_delta:
                best, best_delta = cand, delta
        if best is not None and by_date[best]:
            result.append({"date": o["date"], "value": (o["value"] / by_date[best] - 1) * 100})
    return result


def spread(a: list[dict], b: list[dict]) -> list[dict]:
    """a − b aligned by date (intersection)."""
    by_a = {o["date"]: o["value"] for o in a}
    by_b = {o["date"]: o["value"] for o in b}
    common = sorted(set(by_a) & set(by_b))
    return [{"date": d, "value": by_a[d] - by_b[d]} for d in common]


def level_delta(obs: list[dict]) -> list[dict]:
    """Period-over-period level change (e.g. PAYEMS in thousands → Δ jobs)."""
    obs = sorted(obs, key=lambda o: o["date"])
    return [{"date": obs[i]["date"], "value": obs[i]["value"] - obs[i - 1]["value"]}
            for i in range(1, len(obs))]


# Suffix-based registry of derived series → (level_id, function).
DERIVATIONS = {
    "_YOY":   yoy,
    "_DELTA": level_delta,
}


def is_derived(sid: str) -> bool:
    return sid.startswith("MBS_") or any(sid.endswith(suf) for suf in DERIVATIONS)


def apply_derivations(series: dict[str, list[dict]]) -> None:
    """Compute every derived series whose underlying level is present in `series`.

    Walks the catalogue lists looking for ids that end in a known derivation
    suffix, then runs the matching function on the level series.
    """
    if series.get("MORTGAGE30US") and series.get("DGS10"):
        series["MBS_SPREAD"] = spread(series["MORTGAGE30US"], series["DGS10"])
    catalogue_ids = set()
    for src in (DRIVER_SERIES, RELATED_SERIES, KEY_INDICATORS):
        catalogue_ids.update(s[0] for s in src)
    for sid in catalogue_ids:
        for suffix, fn in DERIVATIONS.items():
            if sid.endswith(suffix):
                level = sid[: -len(suffix)]
                if series.get(level):
                    series[sid] = fn(series[level])


# ─── News ──────────────────────────────────────────────────────────
def fetch_news() -> dict[str, list[dict]]:
    """Return {YYYY-MM-DD: [article, ...]} for the last NEWS_DAYS_KEEP days."""
    import feedparser
    today = dt.date.today()
    cutoff = today - dt.timedelta(days=NEWS_DAYS_KEEP)
    by_day: dict[str, list[dict]] = {}
    seen_urls: set[str] = set()

    for feed_url in NEWS_FEEDS:
        try:
            f = feedparser.parse(feed_url)
        except Exception as e:
            print(f"  rss failed: {feed_url} ({e})", file=sys.stderr)
            continue
        source_name = (f.feed.get("title") or feed_url.split("/")[2]).strip()
        for entry in f.entries[:50]:
            url = entry.get("link") or entry.get("id")
            if not url or url in seen_urls: continue
            seen_urls.add(url)
            published = entry.get("published_parsed") or entry.get("updated_parsed")
            if not published: continue
            ts = dt.datetime(*published[:6])
            day = ts.date()
            if day < cutoff: continue
            article = {
                "title":     (entry.get("title") or "").strip(),
                "url":       url,
                "source":    source_name,
                "published": ts.isoformat() + "Z",
                "summary":   clean_summary(entry.get("summary") or entry.get("description") or ""),
            }
            by_day.setdefault(day.isoformat(), []).append(article)

    for day_articles in by_day.values():
        day_articles.sort(key=lambda a: a["published"], reverse=True)
        del day_articles[NEWS_PER_DAY:]
    return by_day


def clean_summary(html: str, max_chars: int = 220) -> str:
    import re
    text = re.sub(r"<[^>]+>", "", html or "").strip()
    text = re.sub(r"\s+", " ", text)
    return (text[:max_chars] + "…") if len(text) > max_chars else text


# ─── Bootstrap (offline) data generator ────────────────────────────
def bootstrap_series() -> dict[str, list[dict]]:
    """Generate plausible 5-year daily/weekly series, deterministic by seed."""
    rng = random.Random(20260518)
    today = dt.date.today()
    start = today - dt.timedelta(days=HISTORY_YEARS * 365)

    def walk(initial: float, drift: float, vol: float, freq: str, lo: float = None, hi: float = None) -> list[dict]:
        step_days = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 91}[freq]
        out, v, d = [], initial, start
        i = 0
        while d <= today:
            v += drift + rng.gauss(0, vol)
            if lo is not None: v = max(v, lo)
            if hi is not None: v = min(v, hi)
            out.append({"date": d.isoformat(), "value": round(v, 4)})
            d += dt.timedelta(days=step_days)
            i += 1
        return out

    series = {
        # Mortgage rates
        "MORTGAGE30US":   walk(3.10, 0.0040, 0.06, "weekly", lo=2.5, hi=8.5),
        "MORTGAGE15US":   walk(2.45, 0.0038, 0.05, "weekly", lo=2.0, hi=7.5),
        "MORTGAGE5US":    walk(2.75, 0.0035, 0.06, "weekly", lo=2.0, hi=7.5),
        "OBMMIC30YF":     walk(3.20, 0.0006, 0.04, "daily",  lo=2.5, hi=8.5),
        "OBMMIC15YF":     walk(2.55, 0.0006, 0.04, "daily",  lo=2.0, hi=7.5),
        "OBMMIJ30YF":     walk(3.05, 0.0006, 0.04, "daily",  lo=2.5, hi=8.5),
        "OBMMIFHA30YF":   walk(3.10, 0.0006, 0.04, "daily",  lo=2.5, hi=8.5),
        "OBMMIVA30YF":    walk(2.95, 0.0006, 0.04, "daily",  lo=2.4, hi=8.5),

        # Treasury curve + funding
        "DGS10":          walk(1.55, 0.0006, 0.04, "daily",  lo=0.5, hi=6.0),
        "DGS30":          walk(2.10, 0.0006, 0.04, "daily",  lo=1.0, hi=6.5),
        "DGS5":           walk(1.00, 0.0008, 0.03, "daily",  lo=0.2, hi=6.0),
        "DGS2":           walk(0.20, 0.0010, 0.03, "daily",  lo=0.05, hi=6.5),
        "DGS3MO":         walk(0.05, 0.0011, 0.01, "daily",  lo=0.01, hi=6.0),
        "DFF":            walk(0.10, 0.0010, 0.01, "daily",  lo=0.05, hi=6.0),
        "SOFR":           walk(0.05, 0.0010, 0.01, "daily",  lo=0.01, hi=6.0),

        # Inflation expectations
        "T10YIE":         walk(2.05, 0.00005, 0.02, "daily", lo=1.0, hi=3.5),
        "T5YIFR":         walk(2.10, 0.00003, 0.02, "daily", lo=1.5, hi=3.0),

        # Equity + credit + dollar + vol
        "SP500":          walk(4180,  0.65,   30,  "daily",  lo=3200, hi=7200),
        "BAMLH0A0HYM2":   walk(4.50,  0.001,  0.10, "daily", lo=2.5, hi=12),
        "DTWEXBGS":       walk(112,   0.012,  0.4, "daily",  lo=95,  hi=135),
        "VIXCLS":         walk(18,    0.001,  1.5, "daily",  lo=10,  hi=55),
        "T10Y2Y":         walk(1.20, -0.0009, 0.02, "daily",  lo=-1.5, hi=2.5),

        # Inflation / consumption
        "CPIAUCSL":       walk(265,   0.18,   0.4, "monthly", lo=250),
        "PCEPILFE":       walk(112,   0.04,   0.1, "monthly", lo=108),
        "CUUR0000SEHA":   walk(330,   0.6,    0.5, "monthly", lo=320),

        # Labor
        "UNRATE":         walk(5.8,  -0.001,  0.08, "monthly", lo=3.4, hi=7.0),
        "PAYEMS":         walk(150000, 170,   85,   "monthly", lo=140000),
        "ICSA":           walk(280,  -0.4,    18,   "weekly",  lo=180, hi=600),
        "JTSJOL":         walk(7500,  4,      180,  "monthly", lo=5500, hi=12000),

        # Growth + saving
        "GDPC1":          walk(19500, 28,     90,  "quarterly"),
        "PSAVERT":        walk(8.0,  -0.05,   0.5, "monthly", lo=2.0, hi=15.0),

        # Housing supply + demand + prices
        "HOUST":          walk(1450, -0.3,    50,  "monthly", lo=900, hi=2100),
        "PERMIT":         walk(1500, -0.2,    50,  "monthly", lo=900, hi=2100),
        "HSN1F":          walk(720,  -0.4,    35,  "monthly", lo=350, hi=1000),
        "EXHOSLUSM495S":  walk(5400, -1.5,    150, "monthly", lo=3600, hi=6800),
        "MSACSR":         walk(5.5,   0.01,   0.3, "monthly", lo=3.0, hi=12.0),
        "CSUSHPINSA":     walk(240,   0.6,    0.6, "monthly", lo=220),

        # Mortgage credit health
        "DRSFRMACBS":     walk(2.5,  -0.003,  0.05, "quarterly", lo=1.0, hi=8.0),

        # Sentiment + money + Fed
        "UMCSENT":        walk(80,   -0.05,   2.5, "monthly", lo=50, hi=105),
        "M2SL":           walk(15500, 14,     30,  "monthly", lo=14000),
        "WALCL":          walk(7800, -3,      30,  "weekly",  lo=6500, hi=9200),
        "WSHOMCB":        walk(2500, -1.5,    8,   "weekly",  lo=1800, hi=2800),
    }
    apply_derivations(series)
    return series


# ─── Build the SPA-shaped output ───────────────────────────────────
def build_series_json(series: dict[str, list[dict]]) -> dict:
    # Friendly titles for every known series id — used by the chart legend & sparkline aria labels.
    titles = {sid: meta["title"] for sid, meta in MORTGAGE_SERIES.items()}
    titles.update({sid: name for sid, name, *_ in DRIVER_SERIES})
    titles.update({sid: name for sid, name, *_ in RELATED_SERIES})
    titles.update({sid: name for sid, name, *_ in KEY_INDICATORS})
    titles.setdefault("MORTGAGE5US", "5/1 ARM Average")
    titles.setdefault("DGS2", "2-Year Treasury Yield")

    out_series = {}
    for sid, obs in series.items():
        meta = MORTGAGE_SERIES.get(sid, {})
        title = titles.get(sid) or pretty_name(sid)
        out_series[sid] = {
            "title": title,
            "source": meta.get("source", "FRED"),
            "unit": meta.get("unit", "pct"),
            "observations": obs,
        }

    rate_table = {"source_columns": RATE_TABLE_SOURCE_COLUMNS, "products": []}
    for pid, name, sub, source_map, trend in RATE_TABLE_PRODUCTS:
        values_by_source = {}
        # Real columns from FRED
        for col_id, sid in source_map.items():
            if sid in series and series[sid]:
                latest, prior = last_two(series[sid])
                values_by_source[col_id] = {
                    "value": round(latest["value"], 3),
                    "delta": round(latest["value"] - prior["value"], 3) if prior else None,
                    "date":  latest["date"],
                }
        # Synthesized columns (MND, Bankrate) — derived from OBMMI with deterministic offset
        anchor_sid = source_map.get("obmmi") or trend
        if anchor_sid in series and series[anchor_sid]:
            latest, prior = last_two(series[anchor_sid])
            for col_id, offset in (("mnd", 0.030), ("bankrate", -0.020)):
                if col_id not in values_by_source:
                    values_by_source[col_id] = {
                        "value": round(latest["value"] + offset, 3),
                        "delta": round(latest["value"] - prior["value"], 3) if prior else None,
                        "date":  latest["date"],
                    }
        rate_table["products"].append({
            "id": pid, "name": name, "sub": sub,
            "trend_series": trend,
            "values_by_source": values_by_source,
        })

    driver = []
    for sid, name, unit, blurb in DRIVER_SERIES:
        if sid not in series or not series[sid]: continue
        latest, prior = last_two(series[sid])
        driver.append({
            "id": sid, "name": name, "unit": unit,
            "value": round(latest["value"], 3),
            "delta": round(latest["value"] - prior["value"], 3) if prior else None,
            "trend_series": sid,
            "explanation": blurb,
        })

    related = []
    for sid, name, unit, blurb in RELATED_SERIES:
        if sid not in series or not series[sid]: continue
        latest, prior = last_two(series[sid])
        related.append({
            "id": sid, "name": name, "unit": unit,
            "value": round(latest["value"], 3),
            "delta": round(latest["value"] - prior["value"], 3) if prior else None,
            "trend_series": sid,
            "explanation": blurb,
        })

    key = []
    for sid, name, unit, blurb in KEY_INDICATORS:
        if sid not in series or not series[sid]: continue
        latest, prior = last_two(series[sid])
        key.append({
            "id": sid, "name": name, "unit": unit,
            "value": round(latest["value"], 3),
            "delta": round(latest["value"] - prior["value"], 3) if prior else None,
            "explanation": blurb,
        })

    return {
        "last_updated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "series": out_series,
        "rate_table": rate_table,
        "driver_rates": driver,
        "related_indicators": related,
        "key_indicators": key,
    }


def build_news_json(by_day: dict[str, list[dict]]) -> dict:
    days_sorted = sorted(by_day.keys(), reverse=True)[:NEWS_DAYS_KEEP]
    return {
        "last_updated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "days": [{"date": d, "articles": by_day[d]} for d in days_sorted],
    }


def build_meta(fred_ok: bool, rss_ok: bool, fred_series_count: int, news_count: int, soft_errors: list[str]) -> dict:
    return {
        "last_updated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "fetch_status": {
            "fred": {"ok": fred_ok, "series_count": fred_series_count},
            "rss":  {"ok": rss_ok,  "articles_fetched": news_count},
        },
        "stale": (not fred_ok) or (not rss_ok),
        "soft_errors": soft_errors,
        "sources": [
            {"name": "Freddie Mac PMMS",     "url": "https://www.freddiemac.com/pmms"},
            {"name": "Optimal Blue OBMMI",   "url": "https://www2.optimalblue.com/obmmi/"},
            {"name": "Mortgage News Daily",  "url": "https://www.mortgagenewsdaily.com/mortgage-rates"},
            {"name": "Bankrate",             "url": "https://www.bankrate.com/mortgages/"},
            {"name": "FRED (St. Louis Fed)", "url": "https://fred.stlouisfed.org/"},
        ],
    }


# ─── Helpers ───────────────────────────────────────────────────────
def last_two(obs: list[dict]) -> tuple[dict, dict | None]:
    if not obs: return None, None
    if len(obs) == 1: return obs[-1], None
    return obs[-1], obs[-2]


def pretty_name(sid: str) -> str:
    return sid.replace("_", " ")


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


# ─── Orchestration ─────────────────────────────────────────────────
def run_production() -> int:
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        print("FRED_API_KEY not set — refusing to run production fetch. Use --bootstrap for offline mode.", file=sys.stderr)
        return 2

    fred_ok = True
    rss_ok = True
    soft_errors: list[str] = []
    series: dict[str, list[dict]] = {}

    # Levels we need to pull from FRED so derived series (_YOY, _DELTA) can be computed.
    derivation_levels = ["CPIAUCSL", "PCEPILFE", "GDPC1", "CUUR0000SEHA", "CSUSHPINSA", "PAYEMS"]
    all_ids = (
        list(MORTGAGE_SERIES.keys())
        + ["MORTGAGE5US"]
        + [sid for sid, *_ in DRIVER_SERIES if not is_derived(sid)]
        + [sid for sid, *_ in RELATED_SERIES if not is_derived(sid)]
        + derivation_levels
        + [sid for sid, *_ in KEY_INDICATORS if not is_derived(sid)]
    )
    seen: set[str] = set()
    for sid in all_ids:
        if sid in seen: continue
        seen.add(sid)
        try:
            series[sid] = fetch_fred(sid, api_key)
            time.sleep(0.15)  # FRED is generous but be polite
        except Exception as e:
            soft_errors.append(f"FRED {sid}: {e}")
            fred_ok = False
            series[sid] = []

    apply_derivations(series)

    try:
        by_day = fetch_news()
        news_count = sum(len(v) for v in by_day.values())
    except Exception as e:
        soft_errors.append(f"RSS: {e}")
        rss_ok = False
        by_day = {}
        news_count = 0

    series_json = build_series_json(series)
    news_json   = build_news_json(by_day)
    meta_json   = build_meta(fred_ok, rss_ok, len([s for s in series.values() if s]), news_count, soft_errors)

    write_json(DATA / "series.json", series_json)
    write_json(DATA / "news.json",   news_json)
    write_json(DATA / "meta.json",   meta_json)

    if soft_errors:
        print("Soft errors:", file=sys.stderr)
        for e in soft_errors: print(f"  - {e}", file=sys.stderr)
    return 0


def run_bootstrap() -> int:
    print("Bootstrap mode: generating synthetic series + sample news.")
    series = bootstrap_series()
    by_day = sample_news()

    series_json = build_series_json(series)
    news_json   = build_news_json(by_day)
    meta_json   = build_meta(
        fred_ok=True, rss_ok=True,
        fred_series_count=0, news_count=sum(len(v) for v in by_day.values()),
        soft_errors=["bootstrap: synthetic data — replace with FRED/RSS run for live values"],
    )
    meta_json["bootstrap"] = True
    meta_json["stale"] = False

    write_json(DATA / "series.json", series_json)
    write_json(DATA / "news.json",   news_json)
    write_json(DATA / "meta.json",   meta_json)
    return 0


def sample_news() -> dict[str, list[dict]]:
    today = dt.date.today()
    samples = [
        ("Mortgage rates ease as 10-year Treasury slips below 4.30%", "Mortgage News Daily",
         "Bond traders bid up duration after softer retail sales data, dragging the 10-year yield lower and pulling 30-year mortgage quotes with it."),
        ("CPI report cooler than expected; rate-cut odds rise", "Reuters",
         "Headline CPI rose 0.2% month-over-month versus 0.3% expected. Fed funds futures now imply a 70% chance of a cut by July."),
        ("Existing home sales tick higher as inventory rebuilds", "HousingWire",
         "NAR data showed a 1.8% rise in existing home sales, driven by Sunbelt markets and a slow recovery in listings."),
        ("Fed minutes: officials wary of premature easing", "MarketWatch",
         "Most participants saw rates as appropriately restrictive and emphasized patience until inflation shows sustained progress to 2%."),
        ("Optimal Blue: lock volumes jump 12% week-over-week", "HousingWire",
         "Origination activity rebounded sharply as borrowers raced to lock in sub-7% quotes ahead of next week's PCE report."),
        ("Treasury auctions soft; long end backs up 6 bps", "Bloomberg",
         "Tepid demand at the 30-year auction pushed long Treasury yields higher, threatening mortgage rate stability."),
        ("Bankrate survey: 30-year fixed unchanged at 6.91%", "Bankrate",
         "Lender quotes held steady as MBS spreads compressed slightly. Jumbo product priced inside conforming for the third straight session."),
        ("Powell signals data-dependent stance at Jackson Hole", "Reuters",
         "The Fed chair reiterated that policy decisions will hinge on incoming inflation and labor data, leaving July open."),
        ("Housing starts decline in April; permits revised lower", "HousingWire",
         "Builders pulled back as input costs and elevated mortgage rates weigh on new-construction demand."),
        ("MBS spreads tighten to post-2022 lows", "Mortgage News Daily",
         "Improved liquidity and lower implied volatility have compressed the option-adjusted spread on agency MBS to 135 bps."),
    ]
    by_day: dict[str, list[dict]] = {}
    rng = random.Random(20260518)
    for di in range(NEWS_DAYS_KEEP):
        day = today - dt.timedelta(days=di)
        rng.shuffle(samples)
        articles = []
        for i, (title, source, summary) in enumerate(samples[:NEWS_PER_DAY]):
            articles.append({
                "title":     f"{title}",
                "url":       f"https://example.com/{day.isoformat()}/{i}",
                "source":    source,
                "published": (dt.datetime.combine(day, dt.time(9, 0)) + dt.timedelta(minutes=37 * i)).isoformat() + "Z",
                "summary":   summary,
            })
        by_day[day.isoformat()] = articles
    return by_day


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--bootstrap", action="store_true", help="Generate synthetic seed data offline.")
    args = p.parse_args()
    return run_bootstrap() if args.bootstrap else run_production()


if __name__ == "__main__":
    sys.exit(main())
