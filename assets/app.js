// ─── Daily Mortgage Rates · SPA ───────────────────────────────────
// Loads pre-baked JSON from /data, renders every section, wires the
// pill toggle, the interactive Lightweight Charts financial chart,
// and the Formspree alert form.

const RANGE_DAYS = {
  '1D': 1, '1W': 7, '1M': 30, '3M': 90,
  '6M': 180, '1Y': 365, '3Y': 1095, '5Y': 1825,
};

const PALETTE = ['#2c6cf6', '#d9342b', '#1a9d57', '#b07a06', '#7c3aed', '#0891b2'];

const state = {
  series: {},
  rateTable: { source_columns: [], products: [] },
  driverRates: [],
  relatedIndicators: [],
  keyIndicators: [],
  news: { days: [] },
  meta: {},
  range: '3M',
  newsPageIdx: 0,
  chart: null,
  chartSeries: new Map(),
  chartArea: false,
  chartLog: false,
};

// ─── Boot ──────────────────────────────────────────────────────────
init().catch(err => {
  console.error('Init failed:', err);
  document.getElementById('last-updated').textContent = 'Error loading data';
  document.getElementById('last-updated').classList.add('badge-warn');
});

async function init() {
  applyHashRange();
  applySeoMeta();

  const [series, news, meta] = await Promise.all([
    fetchJSON('./data/series.json'),
    fetchJSON('./data/news.json'),
    fetchJSON('./data/meta.json'),
  ]);

  state.series             = series.series || {};
  state.rateTable          = series.rate_table || state.rateTable;
  state.driverRates        = series.driver_rates || [];
  state.relatedIndicators  = series.related_indicators || [];
  state.keyIndicators      = series.key_indicators || [];
  state.news               = news;
  state.meta               = meta;

  renderHeader();
  renderRateTable();
  renderOffers();
  renderActions();
  renderDriverRates();
  renderRelatedIndicators();
  renderKeyIndicators();
  renderNews();

  await waitForGlobal('LightweightCharts', 3000);
  initChart();
  renderPayoffCalc();
  refreshSparklines();

  wirePills();
  wireChartControls();
  wireNewsPager();
  wireForm();
  initConsent();
  window.addEventListener('hashchange', () => { applyHashRange(); refreshRangeUI(); });
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function waitForGlobal(name, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (typeof window[name] !== 'undefined') return resolve(window[name]);
      if (Date.now() - t0 > timeoutMs) return reject(new Error(`${name} not loaded`));
      setTimeout(poll, 50);
    })();
  });
}

// ─── Header ────────────────────────────────────────────────────────
function renderHeader() {
  const updated = state.meta.last_updated;
  const el = document.getElementById('last-updated');
  if (updated) {
    const d = new Date(updated);
    el.textContent = `Updated ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  } else {
    el.textContent = '—';
  }
  if (state.meta.stale) document.getElementById('stale-badge').hidden = false;
}

// ─── Rate table (main) ─────────────────────────────────────────────
function renderRateTable() {
  // Header columns
  const headerCells = state.rateTable.source_columns || [];
  headerCells.forEach((col, i) => {
    const th = document.getElementById(`src-h-${i + 1}`);
    if (th) th.textContent = col.label;
  });

  const links = affiliateLinks();
  const ctaHeader = document.getElementById('cta-h');
  if (ctaHeader) ctaHeader.hidden = !links.length;

  const tbody = document.getElementById('rate-table-body');
  tbody.innerHTML = '';
  let rowIdx = 0;
  for (const product of state.rateTable.products) {
    const tr = document.createElement('tr');
    tr.appendChild(cell(`
      <div class="product-cell">
        <span class="product-name">${escapeHtml(product.name)}</span>
        <span class="product-sub">${escapeHtml(product.sub || '')}</span>
      </div>
    `));
    for (const col of headerCells) {
      const v = (product.values_by_source || {})[col.id];
      tr.appendChild(cell(rateCellHTML(v)));
    }
    const td = document.createElement('td');
    td.innerHTML = sparklineSVG(state.series[product.trend_series], state.range);
    td.dataset.sparkSeries = product.trend_series;
    tr.appendChild(td);
    if (links.length) tr.appendChild(ctaCell(links[rowIdx % links.length]));
    tbody.appendChild(tr);
    rowIdx++;
  }
}

function rateCellHTML(v) {
  if (!v || v.value == null) return '<span class="muted">—</span>';
  return `
    <div class="rate-cell">
      <span class="rate-value">${fmtPct(v.value)}</span>
      <span class="rate-meta">${deltaPill(v.delta)} · ${fmtDate(v.date)}</span>
    </div>
  `;
}

// ─── Driver rates sub-table ────────────────────────────────────────
function renderDriverRates() {
  const tbody = document.getElementById('driver-body');
  tbody.innerHTML = '';
  for (const r of state.driverRates) {
    const tr = document.createElement('tr');
    tr.appendChild(cell(`<span class="indicator-name">${escapeHtml(r.name)}</span><br><span class="muted">${escapeHtml(r.id)}</span>`));
    tr.appendChild(cell(`<span class="rate-value">${fmtValue(r.value, r.unit)}</span>`));
    tr.appendChild(cell(deltaPill(r.delta, r.unit)));
    const td = document.createElement('td');
    td.innerHTML = sparklineSVG(state.series[r.trend_series || r.id], state.range);
    td.dataset.sparkSeries = r.trend_series || r.id;
    tr.appendChild(td);
    tr.appendChild(cell(`<span class="indicator-blurb">${escapeHtml(r.explanation)}</span>`));
    tbody.appendChild(tr);
  }
}

// ─── Related indicators sub-table ──────────────────────────────────
function renderRelatedIndicators() {
  const tbody = document.getElementById('related-body');
  tbody.innerHTML = '';
  for (const r of state.relatedIndicators) {
    const tr = document.createElement('tr');
    tr.appendChild(cell(`<span class="indicator-name">${escapeHtml(r.name)}</span><br><span class="muted">${escapeHtml(r.id)}</span>`));
    tr.appendChild(cell(`<span class="rate-value">${fmtValue(r.value, r.unit)}</span>`));
    tr.appendChild(cell(deltaPill(r.delta, r.unit)));
    const td = document.createElement('td');
    td.innerHTML = sparklineSVG(state.series[r.trend_series || r.id], state.range);
    td.dataset.sparkSeries = r.trend_series || r.id;
    tr.appendChild(td);
    tr.appendChild(cell(`<span class="indicator-blurb">${escapeHtml(r.explanation)}</span>`));
    tbody.appendChild(tr);
  }
}

// ─── Key indicators (cards) ────────────────────────────────────────
function renderKeyIndicators() {
  const grid = document.getElementById('key-grid');
  grid.innerHTML = '';
  for (const k of state.keyIndicators) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-head">
        <span class="card-title">${escapeHtml(k.name)}</span>
        ${deltaPill(k.delta, k.unit)}
      </div>
      <span class="card-value">${fmtValue(k.value, k.unit)}</span>
      <span class="card-explain">${escapeHtml(k.explanation)}</span>
    `;
    grid.appendChild(card);
  }
}

// ─── News (paginated) ──────────────────────────────────────────────
function renderNews() {
  const days = state.news.days || [];
  const label = document.getElementById('news-day-label');
  const list  = document.getElementById('news-list');
  list.innerHTML = '';

  if (!days.length) {
    label.textContent = 'No news yet';
    list.innerHTML = '<li class="loading">No articles available.</li>';
    return;
  }

  state.newsPageIdx = Math.max(0, Math.min(state.newsPageIdx, days.length - 1));
  const day = days[state.newsPageIdx];
  label.textContent = formatDayLabel(day.date, state.newsPageIdx);

  for (const a of day.articles.slice(0, 10)) {
    const li = document.createElement('li');
    li.className = 'news-item';
    li.innerHTML = `
      <span class="news-title"><a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></span>
      <span class="news-source">${escapeHtml(a.source)} · ${fmtTime(a.published)}</span>
      <span class="news-summary">${escapeHtml(a.summary || '')}</span>
    `;
    list.appendChild(li);
  }

  document.querySelector('.pager-btn[data-step="-1"]').disabled = state.newsPageIdx >= days.length - 1;
  document.querySelector('.pager-btn[data-step="1"]').disabled  = state.newsPageIdx <= 0;
}

function formatDayLabel(iso, idx) {
  const d = new Date(iso + 'T00:00:00');
  if (idx === 0) return 'Today · ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (idx === 1) return 'Yesterday · ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Chart (Lightweight Charts) ────────────────────────────────────
function initChart() {
  const container = document.getElementById('chart');
  const css = getComputedStyle(document.documentElement);
  const textColor = css.getPropertyValue('--ink-2').trim() || '#4a5568';
  const gridColor = css.getPropertyValue('--border-2').trim() || '#eef0f6';

  state.chart = LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor, fontFamily: 'inherit' },
    grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { width: 1, style: 0 }, horzLine: { width: 1, style: 0 } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.15 } },
    leftPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.15 }, visible: true },
    timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false, rightOffset: 4 },
    handleScroll: true,
    handleScale: true,
  });

  state.leftPriceScale = state.chart.priceScale('left');

  // Curated default chart: 30-yr fixed, 15-yr fixed, 10-yr Treasury.
  // Anything else can be added via the rate table → trend column or legend.
  const wanted = ['OBMMIC30YF', 'OBMMIC15YF', 'DGS10'].filter(id => state.series[id]);

  const legendEl = document.getElementById('chart-legend');
  legendEl.innerHTML = '';

  wanted.forEach((id, i) => addChartSeries(id, PALETTE[i % PALETTE.length], legendEl));

  state.chart.subscribeCrosshairMove(onCrosshair);
  applyRangeToChart();
}

function addChartSeries(id, color, legendEl) {
  const series = state.series[id];
  if (!series) return;
  const opts = {
    color,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    title: series.title || id,
  };
  const api = state.chartArea
    ? state.chart.addAreaSeries({ ...opts, topColor: color + '55', bottomColor: color + '00', lineColor: color })
    : state.chart.addLineSeries(opts);
  api.setData(observationsToLW(series.observations));
  if (id === 'DGS10' && state.leftPriceScale) api.attachToScale(state.leftPriceScale);
  state.chartSeries.set(id, { api, color, active: true, series });

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'legend-chip';
  chip.dataset.seriesId = id;
  chip.dataset.active = 'true';
  chip.innerHTML = `<span class="swatch" style="background:${color}"></span> ${escapeHtml(shortName(series.title || id))}`;
  chip.addEventListener('click', () => toggleSeries(id));
  legendEl.appendChild(chip);
}

function toggleSeries(id) {
  const entry = state.chartSeries.get(id);
  if (!entry) return;
  entry.active = !entry.active;
  entry.api.applyOptions({ visible: entry.active });
  const chip = document.querySelector(`.legend-chip[data-series-id="${id}"]`);
  if (chip) chip.dataset.active = String(entry.active);
}

function rebuildChartSeries() {
  if (!state.chart) return;
  for (const { api } of state.chartSeries.values()) state.chart.removeSeries(api);
  const ids = [...state.chartSeries.keys()];
  state.chartSeries.clear();
  document.getElementById('chart-legend').innerHTML = '';
  const legendEl = document.getElementById('chart-legend');
  ids.forEach((id, i) => addChartSeries(id, PALETTE[i % PALETTE.length], legendEl));
  applyRangeToChart();
}

function applyRangeToChart() {
  if (!state.chart) return;
  const days = RANGE_DAYS[state.range];
  const all = collectAllDates();
  if (!all.length) return;
  const latest = all[all.length - 1];
  const from = new Date(latest + 'T00:00:00Z');
  from.setUTCDate(from.getUTCDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  state.chart.timeScale().setVisibleRange({ from: fromStr, to: latest });
}

function collectAllDates() {
  const set = new Set();
  for (const { series } of state.chartSeries.values()) {
    for (const o of series.observations) set.add(o.date);
  }
  return [...set].sort();
}

function onCrosshair(param) {
  const el = document.getElementById('chart-hover');
  if (!param.time || !param.point) { el.textContent = ''; return; }
  const date = typeof param.time === 'string'
    ? param.time
    : new Date(param.time * 1000).toISOString().slice(0, 10);
  const parts = [`${date}`];
  for (const [id, entry] of state.chartSeries) {
    if (!entry.active) continue;
    const v = param.seriesData.get(entry.api);
    if (v && v.value != null) parts.push(`${shortName(entry.series.title || id)}: ${fmtPct(v.value)}`);
  }
  el.textContent = parts.join('  ·  ');
}

function wireChartControls() {
  document.getElementById('chart-reset').addEventListener('click', () => {
    if (state.chart) state.chart.timeScale().fitContent();
  });
  document.getElementById('area-toggle').addEventListener('change', e => {
    state.chartArea = e.target.checked;
    rebuildChartSeries();
  });
  document.getElementById('log-toggle').addEventListener('change', e => {
    state.chartLog = e.target.checked;
    state.chart.priceScale('right').applyOptions({
      mode: state.chartLog ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal,
    });
  });
}

// ─── Sparklines (inline SVG) ───────────────────────────────────────
function sparklineSVG(series, range) {
  if (!series || !series.observations || !series.observations.length) return '<span class="muted">—</span>';
  const days = RANGE_DAYS[range];
  const cutoff = Date.now() - days * 86400000;
  const points = series.observations.filter(o => Date.parse(o.date) >= cutoff);
  const data = points.length > 1 ? points : series.observations.slice(-2);

  const w = 120, h = 32, pad = 2;
  const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (w - 2 * pad));
  const vals = data.map(o => o.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const ys = vals.map(v => h - pad - ((v - min) / span) * (h - 2 * pad));

  const linePts = xs.map((x, i) => `${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');
  const fillPts = `${pad},${h - pad} ${linePts} ${(w - pad).toFixed(2)},${h - pad}`;
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? 'var(--up)' : 'var(--down)';

  const firstVal = vals[0].toFixed(2);
  const lastVal = vals[vals.length - 1].toFixed(2);

  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true" title="${firstVal} → ${lastVal}">
      <polygon class="fill" points="${fillPts}" style="fill:color-mix(in srgb, ${color} 15%, transparent)"></polygon>
      <polyline class="line" points="${linePts}" style="fill:none;stroke:${color};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"></polyline>
      <circle class="dot" cx="${xs[xs.length - 1].toFixed(2)}" cy="${ys[ys.length - 1].toFixed(2)}" r="2" style="fill:${color}"></circle>
      <text x="2" y="10" font-size="8" fill="currentColor" opacity="0.6">${firstVal}</text>
      <text x="${(w - 14).toFixed(0)}" y="10" font-size="8" fill="currentColor" opacity="0.6">${lastVal}</text>
    </svg>
  `;
}

function refreshSparklines() {
  document.querySelectorAll('td[data-spark-series]').forEach(td => {
    const id = td.dataset.sparkSeries;
    td.innerHTML = sparklineSVG(state.series[id], state.range);
  });
}

// ─── Pill toggle ───────────────────────────────────────────────────
function wirePills() {
  document.querySelectorAll('.pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.range = btn.dataset.range;
      location.hash = `range=${state.range}`;
      refreshRangeUI();
    });
  });
  refreshRangeUI();
}

function refreshRangeUI() {
  document.querySelectorAll('.pill').forEach(btn => {
    btn.setAttribute('aria-selected', String(btn.dataset.range === state.range));
  });
  const rangeLabel = document.getElementById('range-caption');
  if (rangeLabel) rangeLabel.textContent = `Sparklines & chart show the last ${state.range}`;
  refreshSparklines();
  applyRangeToChart();
}

function applyHashRange() {
  const m = location.hash.match(/range=([^&]+)/);
  if (m && RANGE_DAYS[m[1]]) state.range = m[1];
}

// ─── News pager ────────────────────────────────────────────────────
function wireNewsPager() {
  document.querySelectorAll('.pager-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step, 10);
      state.newsPageIdx = Math.max(0, Math.min((state.news.days || []).length - 1, state.newsPageIdx - step));
      renderNews();
    });
  });
}

// ─── Alert form (Formspree) ────────────────────────────────────────
function wireForm() {
  const form = document.getElementById('alert-form');
  const status = document.getElementById('alert-status');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.textContent = '';
    status.className = 'alert-status';

    const data = new FormData(form);
    if (data.get('_gotcha')) return;
    if (!data.get('email') && !data.get('phone')) {
      status.textContent = 'Provide an email or phone number.';
      status.classList.add('err');
      return;
    }

    const endpoint = window.FORMSPREE_ENDPOINT;
    if (!endpoint || endpoint.includes('xxxxxxxx')) {
      status.textContent = 'Subscriptions not yet configured — paste your Formspree endpoint in config.js.';
      status.classList.add('err');
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json' }, body: data });
      if (res.ok) {
        status.textContent = 'Subscribed — confirmation sent.';
        status.classList.add('ok');
        form.reset();
      } else {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      status.textContent = `Couldn't subscribe: ${err.message}`;
      status.classList.add('err');
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── Monetization (config, offers, ads, analytics, consent) ────────
function cfg() { return window.SITE_CONFIG || {}; }

// A value is "not yet configured" if it's empty or still a shipped placeholder.
function isPlaceholder(s) {
  if (!s) return true;
  const str = String(s);
  return /X{3,}|x{6,}|0{6,}/.test(str) || str.includes('example.com') || str.includes('...');
}

function affiliateLinks() {
  return (cfg().affiliates || []).filter(a => a && a.url && !isPlaceholder(a.url));
}

function ctaCell(a) {
  const td = document.createElement('td');
  const btn = document.createElement('a');
  btn.className = 'cta-link';
  btn.href = a.url;
  btn.target = '_blank';
  btn.rel = 'sponsored noopener';
  btn.textContent = a.cta || 'Get quote';
  btn.addEventListener('click', () => trackEvent('affiliate_click', { partner: a.name, placement: 'rate_table' }));
  td.appendChild(btn);
  return td;
}

function renderOffers() {
  const section = document.getElementById('offers');
  if (!section) return;
  const links = affiliateLinks();
  if (!links.length) { section.hidden = true; return; }
  const wrap = document.getElementById('offers-buttons');
  wrap.innerHTML = '';
  for (const a of links) {
    const link = document.createElement('a');
    link.className = 'offer-btn';
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'sponsored noopener';
    link.textContent = `${a.name} · ${a.cta || 'Get quote'}`;
    link.addEventListener('click', () => trackEvent('affiliate_click', { partner: a.name, placement: 'offers_module' }));
    wrap.appendChild(link);
  }
  section.hidden = false;
}

// Cookie consent gates ad + analytics scripts (required for personalized ads
// in the EEA/UK and for analytics consent). Choice persists in localStorage.
const CONSENT_KEY = 'cookie-consent';
function consentGranted() { return localStorage.getItem(CONSENT_KEY) === 'granted'; }

// Only ads + analytics set cookies; affiliate links don't. No point asking for
// consent until at least one of those is actually configured.
function trackingConfigured() {
  const ad = cfg().adsense || {};
  const ga = cfg().ga4 || {};
  return (ad.enabled && !isPlaceholder(ad.client)) || !isPlaceholder(ga.measurementId);
}

function initConsent() {
  if (!trackingConfigured()) return;
  const choice = localStorage.getItem(CONSENT_KEY);
  if (choice === 'granted') { initAds(); initGA4(); return; }
  if (choice === 'denied') return;
  showConsentBanner();
}

function showConsentBanner() {
  if (document.querySelector('.consent-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'consent-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.innerHTML = `
    <p class="consent-text">We use cookies for analytics and to show relevant ads. See our <a href="./privacy.html">Privacy Policy</a>.</p>
    <div class="consent-actions">
      <button type="button" class="ghost" data-consent="denied">Decline</button>
      <button type="button" class="primary" data-consent="granted">Accept</button>
    </div>`;
  banner.querySelectorAll('[data-consent]').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, btn.dataset.consent);
      banner.remove();
      if (btn.dataset.consent === 'granted') { initAds(); initGA4(); }
    });
  });
  document.body.appendChild(banner);
}

let adsLoaded = false;
function initAds() {
  const ad = cfg().adsense || {};
  if (!ad.enabled || isPlaceholder(ad.client) || !consentGranted()) return;
  if (!adsLoaded) {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ad.client)}`;
    document.head.appendChild(s);
    adsLoaded = true;
  }
  const slots = ad.slots || {};
  document.querySelectorAll('.ad-slot').forEach(slot => {
    if (slot.dataset.filled) return;
    const slotId = slots[slot.dataset.slot];
    if (isPlaceholder(slotId)) return;
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', ad.client);
    ins.setAttribute('data-ad-slot', slotId);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    slot.appendChild(ins);
    slot.dataset.filled = 'true';
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
}

let ga4Loaded = false;
function initGA4() {
  const id = (cfg().ga4 || {}).measurementId;
  if (isPlaceholder(id) || !consentGranted() || ga4Loaded) return;
  ga4Loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}

function trackEvent(name, params) {
  if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
}

function applySeoMeta() {
  const domain = cfg().domain;
  if (isPlaceholder(domain)) return;
  const base = String(domain).replace(/\/+$/, '');
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
  link.href = base + '/';
  let og = document.querySelector('meta[property="og:url"]');
  if (!og) { og = document.createElement('meta'); og.setAttribute('property', 'og:url'); document.head.appendChild(og); }
  og.setAttribute('content', base + '/');
}

// ─── Borrower action cards ─────────────────────────────────────────
const BORROWER_ACTIONS = [
  { bucket: 'today',
    title: "Lock if you're already shopping",
    body: "If your locked quote is below today's national PMMS average, secure it. Rates can move 0.10%+ in a single day." },
  { bucket: 'today',
    title: "Compare at least three lenders",
    body: "The CFPB found borrowers who get three or more quotes save around $3,000 over the life of the loan.",
    cta: true },
  { bucket: 'month',
    title: "Run a refi sanity-check if you're at 7%+",
    body: "If your current rate is ≥0.75% above today's, a refi typically breaks even within ~24 months. Worth a 10-minute estimate.",
    cta: true },
  { bucket: 'month',
    title: "Track the next Fed meeting",
    body: "Mortgage rates respond fast to Fed signals. Mark the next FOMC date and watch the dot plot for direction." },
  { bucket: 'month',
    title: "Build a closing-cost buffer",
    body: "Even at 20% down, expect 2–5% of the purchase price in closing costs. Funnel cash to a high-yield account if you're 30–90 days out." },
];

function renderActions() {
  const today = document.getElementById('actions-today');
  const month = document.getElementById('actions-month');
  if (!today || !month) return;
  today.innerHTML = '';
  month.innerHTML = '';
  const aff = affiliateLinks()[0];
  for (const a of BORROWER_ACTIONS) {
    const card = document.createElement('div');
    card.className = 'card';
    const cta = a.cta && aff
      ? `<div class="card-action"><a class="cta-link" href="${escapeAttr(aff.url)}" target="_blank" rel="sponsored noopener" data-action-title="${escapeAttr(a.title)}">${escapeHtml(aff.cta || 'Get quote')}</a></div>`
      : '';
    card.innerHTML = `
      <div class="card-head"><span class="card-title">${escapeHtml(a.title)}</span></div>
      <span class="card-explain">${escapeHtml(a.body)}</span>
      ${cta}
    `;
    (a.bucket === 'today' ? today : month).appendChild(card);
  }
  document.querySelectorAll('[data-action-title]').forEach(el => {
    el.addEventListener('click', () => trackEvent('action_cta_click', { action: el.dataset.actionTitle, placement: 'actions_cards' }));
  });
}

// ─── Pay-off-early vs S&P 500 calculator ───────────────────────────
// Apples-to-apples: same monthly outlay (P + extra) and same horizon N for
// both strategies, so the comparison reduces to "where does the cash sit?"
function simulatePayoff({ balance, ratePct, years, extra, returnPct }) {
  const N = Math.max(1, Math.round(years * 12));
  const rm = ratePct / 100 / 12;
  const sm = returnPct / 100 / 12;
  const P = rm > 0
    ? balance * (rm * Math.pow(1 + rm, N)) / (Math.pow(1 + rm, N) - 1)
    : balance / N;

  let mortA = balance, invA = 0;   // A: prepay, then invest after payoff
  let mortB = balance, invB = 0;   // B: pay base, invest extra throughout
  const prepay = [], invest = [];
  for (let m = 1; m <= N; m++) {
    if (mortA > 0) {
      const interest = mortA * rm;
      const principal = Math.min(mortA, (P + extra) - interest);
      mortA = Math.max(0, mortA - principal);
    } else {
      invA = invA * (1 + sm) + (P + extra);
    }
    if (mortB > 0) {
      const interest = mortB * rm;
      const principal = Math.min(mortB, P - interest);
      mortB = Math.max(0, mortB - principal);
    }
    invB = invB * (1 + sm) + extra;
    if (m % 12 === 0) {
      prepay.push({ year: m / 12, net: invA - mortA });
      invest.push({ year: m / 12, net: invB - mortB });
    }
  }
  return { prepay, invest, monthlyPayment: P };
}

let payoffChart = null, payoffSeriesA = null, payoffSeriesB = null;
let payoffEventTimer = null;

function renderPayoffCalc() {
  const host = document.getElementById('payoff-chart');
  if (!host || typeof LightweightCharts === 'undefined') return;

  // Default the rate to the latest non-null 30-yr fixed observation if present.
  const obs = (state.series.OBMMIC30YF || {}).observations || [];
  let latestRate = null;
  for (let i = obs.length - 1; i >= 0; i--) {
    if (obs[i].value != null) { latestRate = obs[i].value; break; }
  }
  if (latestRate != null) {
    const el = document.getElementById('calc-rate');
    if (el) el.value = Number(latestRate).toFixed(2);
  }

  const css = getComputedStyle(document.documentElement);
  const textColor = css.getPropertyValue('--ink-2').trim() || '#4a5568';
  const gridColor = css.getPropertyValue('--border-2').trim() || '#eef0f6';
  const accent    = css.getPropertyValue('--accent').trim()  || '#2c6cf6';
  const downColor = css.getPropertyValue('--down').trim()    || '#1a9d57';

  payoffChart = LightweightCharts.createChart(host, {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor, fontFamily: 'inherit' },
    grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { width: 1, style: 0 }, horzLine: { width: 1, style: 0 } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false, rightOffset: 4 },
  });
  payoffSeriesA = payoffChart.addLineSeries({ color: accent,    lineWidth: 2, title: 'Prepay net wealth' });
  payoffSeriesB = payoffChart.addLineSeries({ color: downColor, lineWidth: 2, title: 'Invest net wealth' });

  ['calc-balance', 'calc-rate', 'calc-years', 'calc-extra', 'calc-return'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', recomputePayoff);
  });
  const resetBtn = document.getElementById('calc-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    document.getElementById('calc-balance').value = 400000;
    document.getElementById('calc-rate').value    = latestRate != null ? Number(latestRate).toFixed(2) : 7;
    document.getElementById('calc-years').value   = 30;
    document.getElementById('calc-extra').value   = 500;
    document.getElementById('calc-return').value  = 8;
    recomputePayoff();
  });

  recomputePayoff();
}

function recomputePayoff() {
  const balance   = Number(document.getElementById('calc-balance').value) || 0;
  const ratePct   = Number(document.getElementById('calc-rate').value)    || 0;
  const years     = Number(document.getElementById('calc-years').value)   || 30;
  const extra     = Number(document.getElementById('calc-extra').value)   || 0;
  const returnPct = Number(document.getElementById('calc-return').value)  || 0;

  document.getElementById('calc-extra-out').textContent  = fmtMoney(extra);
  document.getElementById('calc-return-out').textContent = `${returnPct.toFixed(1)}%`;

  const { prepay, invest } = simulatePayoff({ balance, ratePct, years, extra, returnPct });

  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const toPts = arr => arr.map(p => ({
    time: new Date(base.getFullYear() + p.year, base.getMonth(), base.getDate()).toISOString().slice(0, 10),
    value: p.net,
  }));
  payoffSeriesA.setData(toPts(prepay));
  payoffSeriesB.setData(toPts(invest));
  payoffChart.timeScale().fitContent();

  const endA = prepay.length ? prepay[prepay.length - 1].net : 0;
  const endB = invest.length ? invest[invest.length - 1].net : 0;
  const diff = Math.abs(endA - endB);
  const summary = document.getElementById('payoff-summary');
  let label = 'tie';
  if (endB > endA + 1)      { summary.innerHTML = `<strong>Investing wins by ${fmtMoney(diff)}</strong> over ${years} years at ${returnPct.toFixed(1)}% return vs ${ratePct.toFixed(2)}% mortgage.`; label = 'invest'; }
  else if (endA > endB + 1) { summary.innerHTML = `<strong>Prepaying wins by ${fmtMoney(diff)}</strong> over ${years} years at ${returnPct.toFixed(1)}% return vs ${ratePct.toFixed(2)}% mortgage.`; label = 'prepay'; }
  else                      { summary.innerHTML = `<strong>Both strategies tie</strong> over ${years} years at ${returnPct.toFixed(1)}% return vs ${ratePct.toFixed(2)}% mortgage.`; }

  if (payoffEventTimer) clearTimeout(payoffEventTimer);
  payoffEventTimer = setTimeout(() => {
    trackEvent('payoff_calc_used', { winner: label, return_pct: returnPct, rate_pct: ratePct });
  }, 500);
}

function fmtMoney(v) {
  const n = Number(v) || 0;
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000)     return `${sign}$${Math.round(a / 1_000).toLocaleString()}k`;
  return `${sign}$${Math.round(a).toLocaleString()}`;
}

// ─── Helpers ───────────────────────────────────────────────────────
function cell(html) { const td = document.createElement('td'); td.innerHTML = html; return td; }

function fmtPct(v)  { return `${Number(v).toFixed(2)}%`; }
function fmtNumber(v) {
  if (Math.abs(v) >= 1000) return Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return Number(v).toFixed(2);
}
function fmtValue(v, unit) {
  if (v == null) return '—';
  if (unit === 'pct' || unit === '%') return fmtPct(v);
  if (unit === 'index' || unit === 'num') return fmtNumber(v);
  return Number(v).toFixed(2);
}
function fmtDate(s) { return s ? new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'; }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''; }

function deltaPill(delta, unit) {
  if (delta == null) return '<span class="delta-pill delta-flat">—</span>';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const cls  = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-flat';
  const abs  = Math.abs(delta);
  let body;
  if (unit === 'pct' || unit === '%' || unit == null) body = `${sign}${abs.toFixed(2)}`;
  else if (unit === 'index' || unit === 'num')        body = `${sign}${fmtNumber(abs)}`;
  else                                                 body = `${sign}${abs.toFixed(2)}`;
  return `<span class="delta-pill ${cls}">${body}</span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function uniqueOrdered(arr) { const seen = new Set(); return arr.filter(x => x && !seen.has(x) && seen.add(x)); }

function shortName(s) {
  return String(s)
    .replace('Mortgage Average', '')
    .replace('Constant Maturity', '')
    .replace('Year ', 'yr ')
    .replace(' Rate', '')
    .trim();
}

function observationsToLW(obs) {
  return (obs || [])
    .filter(o => o.value != null && !Number.isNaN(o.value))
    .map(o => ({ time: o.date, value: Number(o.value) }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
