// v3: Tabs (Summary / Compare) + Summary metrics & grouped averages
let rawData = []; // full dataset
let filtered = []; // filtered dataset
let trendChart = null; // Chart.js line
let barChart = null; // Chart.js bar
let map, gantryLayer;
let compareChart = null;
let rankChart = null;

const els = {
  gantry: document.getElementById('gantrySelect'),
  f1: document.getElementById('filter1Select'),
  f2: document.getElementById('filter2Select'),
  f3: document.getElementById('filter3Select'),
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  timeGrain: document.getElementById('timeGrain'),
  file: document.getElementById('fileInput'),
  reset: document.getElementById('resetFilters'),
  kpiTotal: document.getElementById('kpiTotal'),
  kpiGantryCount: document.getElementById('kpiGantryCount'),
  kpiAvg: document.getElementById('kpiAvg'),
  trendCanvas: document.getElementById('trendCanvas'),
  barCanvas: document.getElementById('barCanvas'),
  map: document.getElementById('map'),
  dataSource: document.getElementById('dataSource'),
  saveLocal: document.getElementById('saveLocal'),
  clearLocal: document.getElementById('clearLocal'),
  errorBox: document.getElementById('errorBox'),
  toggleRolling: document.getElementById('toggleRolling'),
  toggleCumulative: document.getElementById('toggleCumulative'),
  toggleBaseline: document.getElementById('toggleBaseline'),
  dropZone: document.getElementById('dropZone'),
  importDiag: document.getElementById('importDiag'),
  previewWrap: document.getElementById('previewWrap'),
  previewTable: document.getElementById('previewTable'),
  gantryCompare: document.getElementById('gantryCompareSelect'),
  dateFrom2: document.getElementById('dateFrom2'),
  dateTo2: document.getElementById('dateTo2'),
  compareCanvas: document.getElementById('compareCanvas'),
  rankGantrySelect: document.getElementById('rankGantrySelect'),
  rankCanvas: document.getElementById('rankCanvas'),
  rankList: document.getElementById('rankList'),
  compareLock: document.getElementById('compareLock'),
  applyMatchLength: document.getElementById('applyMatchLength'),
  compareLengthHint: document.getElementById('compareLengthHint'),
  comparePanel: document.querySelector('.compare-panel'),
  header: document.querySelector('.app-header'),
  mainContainer: document.querySelector('main.container')
};

function unique(arr) {
  return [...new Set(arr)].filter(v => v !== '' && v != null).sort();
}
function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}
function fmt(n) {
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2).replace(/\.00$/, '') + 'K';
  return String(n);
}
function getSelected(selectEl) {
  return Array.from(selectEl.selectedOptions || []).map(o => o.value);
}
function setOptions(selectEl, values) {
  const keep = getSelected(selectEl);
  selectEl.innerHTML = '';
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    if (keep.includes(v)) o.selected = true;
    selectEl.appendChild(o);
  });
}

function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date)
    return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const str = String(s).trim();

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  // M/D/Y or D/M/Y
  const m = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let a = +m[1],
      b = +m[2],
      y = +m[3];
    if (y < 100) y += 2000;
    let M, D;
    if (a > 12) {
      D = a;
      M = b;
    } else {
      M = a;
      D = b;
    }
    return new Date(Date.UTC(y, M - 1, D));
  }

  const d = new Date(str);
  if (isNaN(d)) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function showError(msg) {
  els.errorBox.style.display = 'block';
  els.errorBox.textContent = msg;
  setTimeout(() => {
    els.errorBox.style.display = 'none';
  }, 12000);
}
function logDiag(html) {
  els.importDiag.innerHTML = html;
}

// Header normalization
function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_-]+/g, '').replace(/[^a-z0-9]/g, '');
}
const headerAliases = {
  date: ['date', 'dates'],
  gantry: ['gantry', 'gantryid', 'gantryname'],
  filter1: ['filter1', 'f1'],
  filter2: ['filter2', 'f2'],
  filter3: ['filter3', 'f3'],
  trafficvolume: ['trafficvolume', 'volume', 'traffic', 'count'],
  gantrylat: ['gantrylat', 'lat', 'latitude', 'gantrylatitude'],
  gantrylon: ['gantrylon', 'long', 'longitude', 'gantrylongitude', 'gantrylong', 'lon']
};
function mapHeadersRow(obj) {
  const out = {};
  const normKeys = Object.keys(obj).reduce((acc, k) => {
    acc[normalizeHeader(k)] = k;
    return acc;
  }, {});
  function pick(target) {
    for (const alias of headerAliases[target]) {
      const src = normKeys[alias];
      if (src) {
        return obj[src];
      }
    }
    return undefined;
  }
  const rawDate = String(pick('date') || '').trim();
  const d = parseDate(rawDate);
  out['Date'] = d ? d.toISOString().slice(0, 10) : rawDate.slice(0, 10);
  out['Gantry'] = String(pick('gantry') || '').trim();
  out['Filter1'] = String(pick('filter1') || '').trim();
  out['Filter2'] = String(pick('filter2') || '').trim();
  out['Filter3'] = String(pick('filter3') || '').trim();
  out['TrafficVolume'] = Number(pick('trafficvolume')) || 0;
  out['Gantry-Lat'] = Number(pick('gantrylat'));
  out['Gantry-Lon'] = Number(pick('gantrylon'));
  return out;
}

function buildPreview(rows, max = 10) {
  els.previewWrap.style.display = 'block';
  const cols = ['Date', 'Gantry', 'Filter1', 'Filter2', 'Filter3', 'TrafficVolume', 'Gantry-Lat', 'Gantry-Lon'];
  let html =
    '<thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  rows.slice(0, max).forEach(r => {
    html +=
      '<tr>' +
      cols.map(c => `<td>${r[c] === undefined ? '' : r[c]}</td>`).join('') +
      '</tr>';
  });
  html += '</tbody>';
  els.previewTable.innerHTML = html;
}
function tryParse(content, delimiter = null) {
  return new Promise((resolve, reject) => {
    const config = {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      transformHeader: h => h.replace(/^\ufeff/, ''),
      complete: res => resolve(res),
      error: err => reject(err)
    };
    if (delimiter) config.delimiter = delimiter;
    Papa.parse(content, config);
  });
}

async function parseWithFallbacks(file) {
  const name = file.name || '(unknown)';
  const sizeKB = Math.round((file.size || 0) / 1024);
  logDiag(
    `<div>Reading <b>${name}</b> (${sizeKB} KB)</div><div>Attempt 1: UTF-8, auto delimiter…</div>`
  );
  let text = await file.text();
  let res = await tryParse(text).catch(() => null);
  if (res && res.meta) {
    logDiag(
      els.importDiag.innerHTML +
        `<div>Detected delimiter: <b>${res.meta.delimiter || '(auto)'}</b>${
          res.errors?.length ? ` | Errors: ${res.errors.length}` : ''
        }</div>`
    );
  }
  if (res && res.meta && res.meta.fields && res.meta.fields.length <= 1) {
    logDiag(els.importDiag.innerHTML + `<div>Delimiter auto-detect failed, retrying with semicolon…</div>`);
    res = await tryParse(text, ';').catch(() => res);
    if (res && res.meta.fields.length <= 1) {
      logDiag(els.importDiag.innerHTML + `<div>Retrying with tab…</div>`);
      res = await tryParse(text, '\t').catch(() => res);
      if (res && res.meta.fields.length <= 1) {
        logDiag(els.importDiag.innerHTML + `<div>Retrying with space…</div>`);
        res = await tryParse(text, ' ').catch(() => res);
      }
    }
  }
  if (!res || !res.data || res.data.length === 0) {
    logDiag(els.importDiag.innerHTML + `<div>Attempt 2: ISO-8859-1 (latin1)…</div>`);
    const reader = new FileReader();
    const text2 = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('encoding read failed'));
      reader.readAsText(file, 'ISO-8859-1');
    });
    res = await tryParse(text2).catch(() => null);
  }
  return res;
}

function handleParsed(res, sourceLabel = 'imported CSV') {
  const fields = res.meta && res.meta.fields ? res.meta.fields : [];
  const rowCount = (res.data || []).length;
  logDiag(
    els.importDiag.innerHTML +
      `<div>Parsed rows: <b>${rowCount}</b> | Raw headers: <code>${fields.join(', ')}</code></div>`
  );
  const mapped = res.data.map(mapHeadersRow).filter(r => r['Date'] && r['Gantry']);
  const required = ['Date', 'Gantry', 'TrafficVolume', 'Gantry-Lat', 'Gantry-Lon'];
  buildPreview(mapped);
  if (!mapped.length) {
    showError('No rows parsed. Check delimiter/encoding and the diagnostics above.');
    return false;
  }
  const has = {
    Date: mapped.some(r => typeof r['Date'] === 'string' && r['Date'].length >= 8),
    Gantry: mapped.some(r => r['Gantry']),
    TrafficVolume: mapped.some(r => Number.isFinite(r['TrafficVolume']) && r['TrafficVolume'] !== null),
    'Gantry-Lat': mapped.some(r => Number.isFinite(r['Gantry-Lat'])),
    'Gantry-Lon': mapped.some(r => Number.isFinite(r['Gantry-Lon']))
  };
  const missing = required.filter(k => !has[k]);
  if (missing.length) {
    showError(
      'Missing required columns or values: ' +
        missing.join(', ') +
        '. Expected headers (case/spacing flexible): Date, Gantry, TrafficVolume, Gantry-Lat, Gantry-Lon.'
    );
    return false;
  }
  if (res.errors && res.errors.length) {
    const e = res.errors[0];
    logDiag(els.importDiag.innerHTML + `<div>First parse error: Row ${e.row ?? 'n/a'} — ${e.message}</div>`);
  }
  rawData = mapped;
  els.dataSource.textContent = sourceLabel;
  setupUI();
  refreshMapMarkers();
  applyFiltersAndRender();
  logDiag(els.importDiag.innerHTML + `<div>✅ Loaded into dashboard.</div>`);
  return true;
}

function init() {
  if (typeof Papa === 'undefined') showError('Parser (Papa Parse) not loaded (CDN). Drag & drop will not parse.');
  if (typeof Chart === 'undefined') showError('Chart.js not loaded (CDN). Charts will be disabled.');
  if (typeof L === 'undefined') showError('Leaflet not loaded (CDN). Map disabled.');

  // prefer browser-saved dataset; fall back to embedded
  const saved = localStorage.getItem('gantry_data');
  if (saved) {
    try {
      rawData = JSON.parse(saved);
      els.dataSource.textContent = 'browser saved';
    } catch {
      rawData = [];
      els.dataSource.textContent = 'embedded sample';
    }
  } else {
    try {
      rawData = JSON.parse(document.getElementById('embeddedData').textContent);
      els.dataSource.textContent = 'embedded sample';
    } catch {
      rawData = [];
      els.dataSource.textContent = 'embedded sample';
    }
  }

  // Build tabs before UI so we can attach handlers
  // Wire up existing top-tab buttons
  tabButtons().forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  // default to Summary view
  switchTab('summary');


  setupUI();
  initMap();
  applyFiltersAndRender();

  // File input
  els.file.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    els.previewWrap.style.display = 'none';
    logDiag('');
    try {
      const res = await parseWithFallbacks(file);
      if (!res) {
        showError('Parse failed: No result.');
        return;
      }
      handleParsed(res);
      renderSummary(); // keep summary fresh after new data
    } catch (err) {
      showError('Import failed: ' + err.message);
    }
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(ev =>
    els.dropZone.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      els.dropZone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach(ev =>
    els.dropZone.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      els.dropZone.classList.remove('dragover');
    })
  );
  els.dropZone.addEventListener('drop', async e => {
    els.previewWrap.style.display = 'none';
    logDiag('');
    const file = e.dataTransfer.files?.[0];
    if (!file) {
      showError('No file dropped.');
      return;
    }
    try {
      const res = await parseWithFallbacks(file);
      if (!res) {
        showError('Parse failed: No result.');
        return;
      }
      handleParsed(res);
      renderSummary();
    } catch (err) {
      showError('Import failed: ' + err.message);
    }
  });

  // Saves
  els.saveLocal.addEventListener('click', () => {
    try {
      localStorage.setItem('gantry_data', JSON.stringify(rawData));
      els.dataSource.textContent = 'browser saved';
      logDiag(els.importDiag.innerHTML + '<div>Saved in browser storage.</div>');
    } catch (e) {
      showError('Could not save to browser.');
    }
  });
  els.clearLocal.addEventListener('click', () => {
    localStorage.removeItem('gantry_data');
    els.dataSource.textContent = 'embedded sample';
    try {
      rawData = JSON.parse(document.getElementById('embeddedData').textContent);
    } catch {
      rawData = [];
    }
    setupUI();
    refreshMapMarkers();
    applyFiltersAndRender();
    renderSummary();
    logDiag(els.importDiag.innerHTML + '<div>Cleared. Reverted to embedded sample.</div>');
  });

  // toggles
  [document.getElementById('toggleRolling'), document.getElementById('toggleCumulative')].forEach(el =>
    el.addEventListener('change', () => {
      renderTrend();
      renderCompare();
    })
  );
  document.getElementById('toggleBaseline').addEventListener('change', renderTrend);

  // initial summary render
  renderSummary();
}
 
/* ---------- Tabs (use existing buttons & views) ---------- */
let currentTab = 'summary';

const tabButtons = () => Array.from(document.querySelectorAll('.top-tabs .tab'));
const views = {
  summary: document.getElementById('summaryView'),
  compare: document.getElementById('compareView')
};

function switchTab(key) {
  currentTab = key;
  // toggle active class on buttons
  tabButtons().forEach(btn => {
    const isActive = btn.dataset.tab === key;
    btn.classList.toggle('active', isActive);
  });
  // show/hide views
  Object.entries(views).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle('hidden', k !== key);
  });
  // refresh the visible view
  if (key === 'compare') {
    renderCompare();
  } else {
    renderTrend();
    renderSummary();
  }
}

/* ---------- Summary rendering ---------- */
/* ---------- Summary rendering (populate existing DOM) ---------- */
function renderSummary() {
  // Per-row stats on filtered data
  const vals = filtered.map(r => Number(r['TrafficVolume']) || 0);
  const hasVals = vals.length > 0;
  const minV = hasVals ? Math.min(...vals) : 0;
  const maxV = hasVals ? Math.max(...vals) : 0;
  const avgV = hasVals ? Math.round(sum(vals) / vals.length) : 0;

  const sumMinEl = document.getElementById('sumMin');
  const sumMaxEl = document.getElementById('sumMax');
  const sumAvgEl = document.getElementById('sumAvg');
  if (sumMinEl) sumMinEl.textContent = fmt(minV);
  if (sumMaxEl) sumMaxEl.textContent = fmt(maxV);
  if (sumAvgEl) sumAvgEl.textContent = fmt(avgV);

  // Helper to write an "Avg by X" table
  function writeAvgTable(tableId, key) {
    const el = document.getElementById(tableId);
    if (!el) return;

    const agg = new Map(); // value -> {sum,count}
    filtered.forEach(r => {
      const k = r[key] || '(blank)';
      const v = Number(r['TrafficVolume']) || 0;
      const obj = agg.get(k) || { sum: 0, count: 0 };
      obj.sum += v;
      obj.count += 1;
      agg.set(k, obj);
    });

    const rows = [...agg.entries()]
      .map(([k, o]) => ({ k, avg: o.count ? o.sum / o.count : 0 }))
      .sort((a, b) => b.avg - a.avg);

    el.innerHTML = `
      <thead><tr><th>Value</th><th>Avg Transactions</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td>${String(r.k)}</td><td>${fmt(Math.round(r.avg))}</td></tr>`).join('')}
      </tbody>
    `;
  }

  writeAvgTable('avgByF1Table', 'Filter1');
  writeAvgTable('avgByF2Table', 'Filter2');
  writeAvgTable('avgByF3Table', 'Filter3');
}

 

/* ---------- Existing UI / Charts / Map / Compare code (unchanged) ---------- */

function setupUI() {
  setOptions(els.gantry, unique(rawData.map(r => r['Gantry'])));
  setOptions(els.f1, unique(rawData.map(r => r['Filter1'])));
  setOptions(els.f2, unique(rawData.map(r => r['Filter2'])));
  setOptions(els.f3, unique(rawData.map(r => r['Filter3'])));
  const dates = unique(rawData.map(r => r['Date'])).sort();
  if (dates.length) {
    els.dateFrom.value = dates[0];
    els.dateTo.value = dates[dates.length - 1];
  }

  [els.gantry, els.f1, els.f2, els.f3, els.timeGrain].forEach(el =>
    el.addEventListener('change', () => {
      applyFiltersAndRender();
      renderSummary(); // keep summary in sync
      switchTab(currentTab);
    })
  );
  [els.dateFrom, els.dateTo].forEach(el =>
    el.addEventListener('input', () => {
      applyFiltersAndRender();
      renderSummary();
      switchTab(currentTab);
    })
  );
  setOptions(els.gantryCompare, unique(rawData.map(r => r['Gantry'])));
  els.dateFrom2.value = els.dateFrom.value || '';
  els.dateTo2.value = els.dateTo.value || '';

  // Rank selector: default "All Selected" + per-gantry options from the main selection
  function refreshRankSelector() {
    const selected = getSelected(els.gantry);
    const values = selected.length ? selected : unique(rawData.map(r => r['Gantry']));
    const opts = ['ALL', ...values];
    els.rankGantrySelect.innerHTML = '';
    opts.forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v === 'ALL' ? 'All selected gantries' : v;
      els.rankGantrySelect.appendChild(o);
    });
    els.rankGantrySelect.value = 'ALL';
  }
  refreshRankSelector();

  // Wire events for compare + ranking
  [els.gantryCompare, els.dateFrom2, els.dateTo2].forEach(el => el.addEventListener('change', renderCompare));
  els.rankGantrySelect.addEventListener('change', renderTopDays);
  document.getElementById('resetFilters').addEventListener('click', () => {
    [els.gantry, els.f1, els.f2, els.f3].forEach(el => {
      Array.from(el.options).forEach(o => (o.selected = false));
    });
    const allDates = unique(rawData.map(r => r['Date'])).sort();
    els.dateFrom.value = allDates[0] || '';
    els.dateTo.value = allDates[allDates.length - 1] || '';
    els.timeGrain.value = 'auto';
    // sync compare window to main when resetting
    els.dateFrom2.value = els.dateFrom.value;
    els.dateTo2.value = els.dateTo.value;
    // refresh rank dropdown
    (function () {
      const selected = getSelected(els.gantry);
      const values = selected.length ? selected : unique(rawData.map(r => r['Gantry']));
      const opts = ['ALL', ...values];
      els.rankGantrySelect.innerHTML = '';
      opts.forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v === 'ALL' ? 'All selected gantries' : v;
        els.rankGantrySelect.appendChild(o);
      });
      els.rankGantrySelect.value = 'ALL';
    })();
    applyFiltersAndRender();
    renderSummary();
  });

  function updateLengthHint() {
    const d1 = els.dateFrom.value ? parseDate(els.dateFrom.value) : null;
    const d2 = els.dateTo.value ? parseDate(els.dateTo.value) : null;
    const c1 = els.dateFrom2.value ? parseDate(els.dateFrom2.value) : null;
    const c2 = els.dateTo2.value ? parseDate(els.dateTo2.value) : null;
    let mainLen = d1 && d2 ? daysBetweenUTC(d1, d2) : 0;
    let cmpLen = c1 && c2 ? daysBetweenUTC(c1, c2) : 0;
    els.compareLengthHint.textContent =
      mainLen && cmpLen
        ? `Main: ${mainLen} day(s) • Compare: ${cmpLen} day(s)`
        : mainLen
        ? `Main: ${mainLen} day(s)`
        : cmpLen
        ? `Compare: ${cmpLen} day(s)`
        : '';
  }
  [els.dateFrom, els.dateTo, els.dateFrom2, els.dateTo2].forEach(el => {
    el.addEventListener('change', () => {
      updateLengthHint();
      renderCompare();
    });
  });
  els.compareLock.addEventListener('change', renderCompare);
  els.applyMatchLength.addEventListener('click', () => {
    const d1 = els.dateFrom.value ? parseDate(els.dateFrom.value) : null;
    const d2 = els.dateTo.value ? parseDate(els.dateTo.value) : null;
    const c1 = els.dateFrom2.value ? parseDate(els.dateFrom2.value) : null;
    if (!d1 || !d2 || !c1) {
      showError('Set Main From/To and Compare From first.');
      return;
    }
    const len = daysBetweenUTC(d1, d2); // inclusive length
    const newTo = addDaysUTC(c1, len - 1);
    els.dateTo2.value = newTo.toISOString().slice(0, 10);
    updateLengthHint();
    renderCompare();
  });
  updateLengthHint();
}

function renderCompare() {
  if (!els.compareCanvas) return;

  const mainRows = filtered;
  const selCompare = getSelected(els.gantryCompare);
  const dFrom2 = els.dateFrom2.value ? parseDate(els.dateFrom2.value) : null;
  const dTo2 = els.dateTo2.value ? parseDate(els.dateTo2.value) : null;
  const selF1 = getSelected(els.f1),
    selF2 = getSelected(els.f2),
    selF3 = getSelected(els.f3);
  const compareRows = filterByCriteria(rawData, {
    gantries: selCompare,
    f1: selF1,
    f2: selF2,
    f3: selF3,
    dFrom: dFrom2,
    dTo: dTo2
  });

  const mainAgg = aggSeries(mainRows, 'day');
  const cmpAgg = aggSeries(compareRows, 'day');
  const mainLen = mainAgg.labels.length;
  const cmpLen = cmpAgg.labels.length;
  let L = Math.min(mainLen, cmpLen);
  if (els.compareLock && els.compareLock.checked) {
    L = Math.min(mainLen, cmpLen, mainLen);
  }
  const mainDates = mainAgg.labels.slice(0, L);
  const mainVals = mainAgg.values.slice(0, L);
  const cmpDates = cmpAgg.labels.slice(0, L);
  const cmpVals = cmpAgg.values.slice(0, L);
  const x = Array.from({ length: L }, (_, i) => `Day ${i + 1}`);

  if (compareChart) {
    compareChart.destroy();
  }
  const ctx = els.compareCanvas.getContext('2d');
  compareChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: x,
      datasets: [
        { label: `Main (${mainDates[0] || '–'} → ${mainDates[L - 1] || '–'})`, data: mainVals, tension: 0.25 },
        {
          label: `Compare (${cmpDates[0] || '–'} → ${cmpDates[L - 1] || '–'})`,
          data: cmpVals,
          tension: 0.25,
          borderDash: [6, 4]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            afterBody: items => {
              const i = items[0].dataIndex;
              const md = mainDates[i] || '–';
              const cd = cmpDates[i] || '–';
              return [`Main date: ${md}`, `Compare date: ${cd}`];
            }
          }
        }
      },
      scales: { y: { ticks: { callback: v => fmt(v) } } }
    }
  });

  const tbody = document.querySelector('#compareTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < L; i++) {
    const tr = document.createElement('tr');
    const md = mainDates[i] || '';
    const mv = Number(mainVals[i] || 0);
    const cd = cmpDates[i] || '';
    const cv = Number(cmpVals[i] || 0);
    const d = pctDelta(cv, mv); // compare vs main
    const dTxt = d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
    [i + 1, md, fmt(mv), cd, fmt(cv), dTxt].forEach(v => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function renderTopDays() {
  if (!els.rankCanvas) return;
  const focus = els.rankGantrySelect ? els.rankGantrySelect.value : 'ALL';
  let rows = filtered;
  if (focus && focus !== 'ALL') {
    rows = rows.filter(r => r['Gantry'] === focus);
  }
  const byDay = new Map(); // key: YYYY-MM-DD => sum
  rows.forEach(r => {
    const d = parseDate(r['Date']);
    if (!d) return;
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + (Number(r['TrafficVolume']) || 0));
  });
  const pairs = [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = pairs.map(p => p[0]);
  const values = pairs.map(p => p[1]);
  if (rankChart) rankChart.destroy();
  const ctx = els.rankCanvas.getContext('2d');
  rankChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: focus === 'ALL' ? 'All selected gantries' : focus, data: values }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: v => fmt(v) } } }
    }
  });
  if (els.rankList) {
    els.rankList.innerHTML = pairs
      .map(([d, v], i) => `<div>${i + 1}. <b>${d}</b> — ${fmt(v)}</div>`)
      .join('');
  }
}

function applyFiltersAndRender() {
  (function syncRankSelector() {
    const selected = getSelected(els.gantry);
    const values = selected.length ? selected : unique(rawData.map(r => r['Gantry']));
    const existing = Array.from(els.rankGantrySelect.options).map(o => o.value);
    const desired = ['ALL', ...values];
    if (existing.join('|') !== desired.join('|')) {
      els.rankGantrySelect.innerHTML = '';
      desired.forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v === 'ALL' ? 'All selected gantries' : v;
        els.rankGantrySelect.appendChild(o);
      });
      els.rankGantrySelect.value = 'ALL';
    }
  })();

  const selG = getSelected(els.gantry);
  const selF1 = getSelected(els.f1),
    selF2 = getSelected(els.f2),
    selF3 = getSelected(els.f3);
  const dFrom = els.dateFrom.value ? parseDate(els.dateFrom.value) : null;
  const dTo = els.dateTo.value ? parseDate(els.dateTo.value) : null;

  filtered = rawData.filter(r => {
    const rd = parseDate(r['Date']);
    if (dFrom && (!rd || rd < dFrom)) return false;
    if (dTo && (!rd || rd > dTo)) return false;
    if (selG.length && !selG.includes(r['Gantry'])) return false;
    if (selF1.length && !selF1.includes(r['Filter1'])) return false;
    if (selF2.length && !selF2.includes(r['Filter2'])) return false;
    if (selF3.length && !selF3.includes(r['Filter3'])) return false;
    return true;
  });

  const total = sum(filtered.map(r => r['TrafficVolume']));
  const gCount = unique(filtered.map(r => r['Gantry'])).length;
  const avg = gCount ? total / gCount : 0;
  els.kpiTotal.textContent = fmt(total);
  els.kpiGantryCount.textContent = fmt(gCount);
  els.kpiAvg.textContent = fmt(Math.round(avg));

  renderTrend();
  renderBar();
  refreshMapMarkers();
  renderCompare();
  renderTopDays();
  if (currentTab === 'summary') renderSummary();
}

// Trend helpers
function aggSeries(rows, grain) {
  const map = new Map();
  rows.forEach(r => {
    const d = parseDate(r['Date']);
    if (!d) return;
    const key =
      grain === 'month'
        ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
        : d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + (Number(r['TrafficVolume']) || 0));
  });
  const labels = Array.from(map.keys()).sort();
  const values = labels.map(k => map.get(k));
  return { labels, values };
}
function rollingAvg(values, window = 7) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    out.push(Math.round(avg));
  }
  return out;
}
function cumulative(values) {
  const out = [];
  let run = 0;
  for (const v of values) {
    run += v;
    out.push(run);
  }
  return out;
}

function renderTrend() {
  let grain = els.timeGrain.value;
  if (grain === 'auto') {
    const dFrom = els.dateFrom.value ? parseDate(els.dateFrom.value) : null;
    const dTo = els.dateTo.value ? parseDate(els.dateTo.value) : null;
    if (dFrom && dTo) {
      const spanDays = Math.max(1, Math.round((dTo - dFrom) / (1000 * 60 * 60 * 24)));
      grain = spanDays > 120 ? 'month' : 'day';
    } else {
      grain = 'day';
    }
  }
  const selectedG = getSelected(els.gantry);
  const wantRolling = document.getElementById('toggleRolling').checked;
  const wantCum = document.getElementById('toggleCumulative').checked;

  const labelsSet = new Set();
  const datasets = [];
  const byGantry = unique(filtered.map(r => r['Gantry']));
  byGantry.forEach(g => {
    const rows = filtered.filter(r => r['Gantry'] === g);
    const { labels, values } = aggSeries(rows, grain);
    labels.forEach(l => labelsSet.add(l));
    let y = values.slice();
    if (wantRolling) y = rollingAvg(y, 7);
    if (wantCum) y = cumulative(y);
    datasets.push({ label: g, dataMap: new Map(labels.map((l, i) => [l, y[i]])) });
  });

  // Baseline
  if (document.getElementById('toggleBaseline').checked) {
    const selRows = selectedG.length ? filtered.filter(r => selectedG.includes(r['Gantry'])) : filtered;
    const restRows = selectedG.length ? filtered.filter(r => !selectedG.includes(r['Gantry'])) : [];
    const parts = [{ label: selectedG.length ? 'Selected' : 'All', rows: selRows }];
    if (selectedG.length) parts.push({ label: 'Others', rows: restRows });
    parts.forEach(p => {
      const { labels, values } = aggSeries(p.rows, grain);
      labels.forEach(l => labelsSet.add(l));
      let y = values.slice();
      if (wantRolling) y = rollingAvg(y, 7);
      if (wantCum) y = cumulative(y);
      datasets.push({
        label: p.label,
        dataMap: new Map(labels.map((l, i) => [l, y[i]])),
        dashed: p.label === 'Others'
      });
    });
  }

  const labels = [...labelsSet].sort();
  const chartSets = datasets.map(s => ({
    label: s.label,
    data: labels.map(l => s.dataMap.get(l) || 0),
    fill: false,
    tension: 0.25,
    borderDash: s.dashed ? [6, 6] : undefined
  }));

  if (trendChart) {
    trendChart.destroy();
  }
  const ctx = els.trendCanvas.getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: chartSets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } } }
  });
}

function renderBar() {
  if (!filtered.length) {
    if (barChart) {
      barChart.destroy();
      barChart = null;
    }
    return;
  }
  const dates = unique(filtered.map(r => r['Date'])).sort();
  const latest = dates[dates.length - 1];
  const totals = new Map();
  filtered
    .filter(r => r['Date'] === latest)
    .forEach(r => {
      const g = r['Gantry'];
      totals.set(g, (totals.get(g) || 0) + (Number(r['TrafficVolume']) || 0));
    });
  const pairs = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const labels = pairs.map(p => p[0]);
  const values = pairs.map(p => p[1]);
  if (barChart) {
    barChart.destroy();
  }
  const ctx = els.barCanvas.getContext('2d');
  barChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: `Top on ${latest}`, data: values }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: v => fmt(v) } } }
    }
  });
}

function initMap() {
  map = L.map('map', { zoomControl: true, scrollWheelZoom: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);
  gantryLayer = L.layerGroup().addTo(map);
  refreshMapMarkers();
}

function refreshMapMarkers() {
  if (!map) return;
  gantryLayer.clearLayers();
  const agg = new Map();
  filtered.forEach(r => {
    const key = r['Gantry'];
    const obj =
      agg.get(key) || {
        sum: 0,
        count: 0,
        lat: r['Gantry-Lat'],
        lon: r['Gantry-Lon']
      };
    obj.sum += Number(r['TrafficVolume']) || 0;
    obj.count += 1;
    agg.set(key, obj);
  });
  const bounds = L.latLngBounds();
  agg.forEach((o, id) => {
    if (isNaN(o.lat) || isNaN(o.lon)) return;
    const avg = o.count ? o.sum / o.count : 0;
    const size = Math.max(6, Math.min(18, 6 + Math.sqrt(avg) / 10));
    const icon = L.divIcon({
      className: 'gantry-icon',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#60a5fa;border:2px solid rgba(255,255,255,0.6);box-shadow:0 0 10px rgba(96,165,250,0.8)"></div>`,
      iconSize: [size, size]
    });
    const m = L.marker([o.lat, o.lon], { icon }).addTo(gantryLayer);
    m.bindTooltip(`Gantry ${id} • Avg: ${Math.round(avg)}`, { sticky: true });
    m.on('click', () => {
      const opt = Array.from(els.gantry.options).find(o2 => o2.value === id);
      if (opt) opt.selected = !opt.selected;
      applyFiltersAndRender();
      renderSummary();
    });
    bounds.extend([o.lat, o.lon]);
  });
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.2));
  else map.setView([20, 0], 2);
}

function filterByCriteria(data, { gantries = [], f1 = [], f2 = [], f3 = [], dFrom = null, dTo = null }) {
  return data.filter(r => {
    const rd = parseDate(r['Date']);
    if (dFrom && (!rd || rd < dFrom)) return false;
    if (dTo && (!rd || rd > dTo)) return false;
    if (gantries.length && !gantries.includes(r['Gantry'])) return false;
    if (f1.length && !f1.includes(r['Filter1'])) return false;
    if (f2.length && !f2.includes(r['Filter2'])) return false;
    if (f3.length && !f3.includes(r['Filter3'])) return false;
    return true;
  });
}

function daysBetweenUTC(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1; // inclusive
}
function addDaysUTC(d, n) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function pctDelta(current, base) {
  if (base === 0) return null;
  return ((current - base) / base) * 100;
}

document.addEventListener('DOMContentLoaded', init);
