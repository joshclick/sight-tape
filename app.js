// ── State ─────────────────────────────────────────────────────────────────────
const state = { marks: [] };
let _nextId = 1;
function genId() { return _nextId++; }

// ── Persistence ───────────────────────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem('smc', JSON.stringify(state.marks)); } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem('smc');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return false;
    state.marks = saved;
    _nextId = Math.max(...state.marks.map(m => m.id)) + 1;
    return true;
  } catch (_) { return false; }
}

// ── Mark CRUD ─────────────────────────────────────────────────────────────────
function addMark(distance = '', unit = 'm', value = '') {
  state.marks.push({ id: genId(), distance, unit, value });
  renderTable();
  renderPreview();
  saveState();
}

function removeMark(id) {
  state.marks = state.marks.filter(m => m.id !== id);
  renderTable();
  renderPreview();
  saveState();
}

function updateMark(id, field, val) {
  const m = state.marks.find(m => m.id === id);
  if (!m) return;
  m[field] = val;
  renderPreview();
  saveState();
}

// ── Valid marks ───────────────────────────────────────────────────────────────
function getValidMarks() {
  return state.marks
    .filter(m => m.distance !== '' && m.value !== '' &&
                 !isNaN(parseFloat(m.distance)) && !isNaN(parseFloat(m.value)))
    .map(m => ({ ...m, distance: parseFloat(m.distance), value: parseFloat(m.value) }))
    .sort((a, b) => a.value - b.value);
}

// ── Physics model ─────────────────────────────────────────────────────────────
// Sight mark = a + b·d  (d in metres, least-squares fit)
//
// Derived from ballistic trajectory: the required launch angle
//   α = ½·arcsin(g·d / v²)
// is within 1.3% of linear across the 18–70 m range (small-angle regime,
// angles < 10°), so equal distance increments produce equal mark increments.

const YD_TO_M = 0.9144;

const STANDARD_DISTANCES = [
  { d: 18,            label: '18m'  },
  { d: 20,            label: '20m'  },
  { d: 25,            label: '25m'  },
  { d: 30,            label: '30m'  },
  { d: 40 * YD_TO_M,  label: '40yd' },
  { d: 40,            label: '40m'  },
  { d: 50 * YD_TO_M,  label: '50yd' },
  { d: 50,            label: '50m'  },
  { d: 60 * YD_TO_M,  label: '60yd' },
  { d: 60,            label: '60m'  },
  { d: 70,            label: '70m'  },
];

function toMeters(distance, unit) {
  return unit === 'yd' ? parseFloat(distance) * YD_TO_M : parseFloat(distance);
}

function fitModel(marks) {
  const pts = marks
    .map(m => ({ x: toMeters(m.distance, m.unit), y: parseFloat(m.value) }))
    .filter(p => isFinite(p.x) && isFinite(p.y) && p.x > 0);
  if (pts.length < 2) return null;

  const n   = pts.length;
  const sX  = pts.reduce((s, p) => s + p.x,       0);
  const sX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sY  = pts.reduce((s, p) => s + p.y,       0);
  const sXY = pts.reduce((s, p) => s + p.x * p.y, 0);
  const det = n * sX2 - sX * sX;
  if (Math.abs(det) < 1e-10) return null;

  const a = (sY * sX2 - sXY * sX) / det;
  const b = (n * sXY  - sX  * sY) / det;
  return dMeters => a + b * dMeters;
}

// ── Reference table ───────────────────────────────────────────────────────────
function buildReferenceTable() {
  const valid = getValidMarks();
  if (valid.length === 0) return '<p class="no-marks-msg">Add sight marks above.</p>';

  const predict = fitModel(valid);

  const enteredRows = valid.map(m => ({
    label: `${m.distance}${m.unit}`,
    value: m.value,
    calc: false,
    dMeters: toMeters(m.distance, m.unit),
  }));

  const rows = [...enteredRows];

  if (predict) {
    STANDARD_DISTANCES.forEach(std => {
      const covered = enteredRows.some(r => Math.abs(r.dMeters - std.d) < 0.001);
      if (!covered) {
        const v = predict(std.d);
        if (isFinite(v)) rows.push({ label: std.label, value: v, calc: true, dMeters: std.d });
      }
    });
  }

  rows.sort((a, b) => a.dMeters - b.dMeters);

  const html = rows.map(r => {
    const valStr = parseFloat(r.value).toFixed(1);
    const cls    = r.calc ? ' class="tr-calc"' : '';
    const disp   = r.calc ? `~${valStr}` : valStr;
    return `<tr${cls}><td class="td-out-dist">${r.label}</td><td class="td-out-val">${disp}</td></tr>`;
  }).join('');

  const note = predict
    ? `<tfoot><tr><td colspan="2" class="td-calc-note">~ = estimated from your marks</td></tr></tfoot>`
    : '';

  return `<table class="ref-table">
    <thead><tr><th>Distance</th><th>Sight Mark</th></tr></thead>
    <tbody>${html}</tbody>${note}
  </table>`;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('marks-tbody');
  tbody.innerHTML = '';
  const sorted = [...state.marks].sort((a, b) => {
    const da = parseFloat(a.distance), db = parseFloat(b.distance);
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return toMeters(da, a.unit) - toMeters(db, b.unit);
  });
  sorted.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-dist"><input type="number" value="${m.distance}" placeholder="e.g. 18"
        onchange="updateMark(${m.id},'distance',this.value)" min="1" max="500"></td>
      <td class="td-unit"><select onchange="updateMark(${m.id},'unit',this.value)">
        <option value="m"  ${m.unit === 'm'  ? 'selected' : ''}>m</option>
        <option value="yd" ${m.unit === 'yd' ? 'selected' : ''}>yd</option>
      </select></td>
      <td class="td-val"><input type="number" value="${m.value}" placeholder="value" step="0.1"
        onchange="updateMark(${m.id},'value',this.value)"></td>
      <td><button class="btn-del" onclick="removeMark(${m.id})" title="Remove">×</button></td>`;
    tbody.appendChild(tr);
  });
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function niceStep(rough) {
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / mag;
  if (f < 1.5) return mag;
  if (f < 3.5) return 2 * mag;
  if (f < 7.5) return 5 * mag;
  return 10 * mag;
}

function buildChart() {
  const valid = getValidMarks();
  if (valid.length < 2) return '';
  const predict = fitModel(valid);
  if (!predict) return '';

  const entered = valid.map(m => ({
    d: toMeters(m.distance, m.unit),
    v: m.value,
    label: `${m.distance}${m.unit}`,
  }));

  const estimated = [];
  STANDARD_DISTANCES.forEach(std => {
    const covered = entered.some(e => Math.abs(e.d - std.d) < 0.1);
    if (!covered) {
      const v = predict(std.d);
      if (isFinite(v)) estimated.push({ d: std.d, v, label: std.label });
    }
  });

  const allPts = [...entered, ...estimated];
  const allD   = allPts.map(p => p.d);
  const allV   = allPts.map(p => p.v);

  const W = 540, H = 210;
  const ml = 46, mr = 12, mt = 12, mb = 36;
  const cw = W - ml - mr, ch = H - mt - mb;

  const dMin = Math.min(...allD), dMax = Math.max(...allD);
  const vMin = Math.min(...allV), vMax = Math.max(...allV);
  const dSpan = dMax - dMin || 10;
  const vSpan = vMax - vMin || 10;
  const d0 = dMin - dSpan * 0.08, d1 = dMax + dSpan * 0.08;
  const v0 = vMin - vSpan * 0.12, v1 = vMax + vSpan * 0.12;

  const sx = d => ml + (d - d0) / (d1 - d0) * cw;
  const sy = v => mt + ch - (v - v0) / (v1 - v0) * ch;

  const linePts = Array.from({ length: 81 }, (_, i) => {
    const d = d0 + (d1 - d0) * i / 80;
    return `${sx(d).toFixed(1)},${sy(predict(d)).toFixed(1)}`;
  }).join(' ');

  const vStep = niceStep(vSpan / 4);
  const vGridStart = Math.ceil(v0 / vStep) * vStep;
  const gridLines = [];
  for (let v = vGridStart; v <= v1 + vStep * 0.01; v += vStep) {
    const y = sy(v).toFixed(1);
    gridLines.push(`
      <line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="var(--border-light)" stroke-width="1"/>
      <text x="${ml - 6}" y="${y}" fill="var(--text-dim)" font-size="10" text-anchor="end" dominant-baseline="middle">${v.toFixed(0)}</text>`);
  }

  const xLabels = entered.map(e =>
    `<text x="${sx(e.d).toFixed(1)}" y="${(mt + ch + 16).toFixed(1)}"
      fill="var(--text-dim)" font-size="10" text-anchor="middle">${e.label}</text>`
  ).join('');

  const estDots = estimated.map(p =>
    `<circle cx="${sx(p.d).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="3.5"
      fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.65"/>`
  ).join('');

  const enteredDots = entered.map(p =>
    `<circle cx="${sx(p.d).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="4.5" fill="var(--text)"/>`
  ).join('');

  return `<div class="chart-wrap">
    <div class="chart-legend">
      <span><svg width="10" height="10" style="vertical-align:middle"><circle cx="5" cy="5" r="4" fill="var(--text)"/></svg> Your marks</span>
      <span><svg width="10" height="10" style="vertical-align:middle"><circle cx="5" cy="5" r="4" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg> Estimated</span>
      <span><svg width="18" height="10" style="vertical-align:middle"><line x1="0" y1="5" x2="18" y2="5" stroke="var(--accent)" stroke-width="2" opacity="0.5"/></svg> Fitted line</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;overflow:visible">
      ${gridLines.join('')}
      <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ch}" stroke="var(--border)" stroke-width="1"/>
      <line x1="${ml}" y1="${mt + ch}" x2="${W - mr}" y2="${mt + ch}" stroke="var(--border)" stroke-width="1"/>
      <polyline points="${linePts}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.45"/>
      ${estDots}
      ${enteredDots}
      ${xLabels}
    </svg>
  </div>`;
}

function renderPreview() {
  document.getElementById('tape-preview').innerHTML = buildReferenceTable() + buildChart();
}

// ── Import / Export (CSV, no headers) ─────────────────────────────────────────
function marksToCSV() {
  return state.marks.map(m => `${m.distance},${m.unit},${m.value}`).join('\n');
}

function toggleIOPanel() {
  const panel = document.getElementById('io-panel');
  const open = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'block' : 'none';
  if (open) document.getElementById('io-textarea').value = marksToCSV();
}

function copyToClipboard() {
  const ta = document.getElementById('io-textarea');
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => {
    const btn = document.getElementById('io-copy-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(() => { document.execCommand('copy'); });
}

function loadFromTextarea() {
  const raw = document.getElementById('io-textarea').value.trim();
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) { alert('No marks found.'); return; }
  const parsed = lines.map(l => {
    const parts = l.split(',');
    return { distance: parts[0]?.trim(), unit: parts[1]?.trim() || 'm', value: parts[2]?.trim() };
  }).filter(m => m.distance && m.value && !isNaN(parseFloat(m.distance)) && !isNaN(parseFloat(m.value)));
  if (parsed.length === 0) { alert('Could not read any marks. Expected: distance,unit,value'); return; }
  if (state.marks.length > 0 && !confirm(`Replace ${state.marks.length} mark(s) with ${parsed.length}?`)) return;
  state.marks = [];
  _nextId = 1;
  parsed.forEach(({ distance, unit, value }) => addMark(distance, unit, value));
  document.getElementById('io-panel').style.display = 'none';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const hadSaved = loadState();
  if (hadSaved) {
    renderTable();
    renderPreview();
  } else {
    addMark(18, 'm', 15);
    addMark(39, 'm', 47);
    addMark(55, 'm', 82);
    addMark(68, 'm', 113);
  }

  document.getElementById('add-mark-btn').addEventListener('click', () => addMark());
  document.getElementById('io-toggle-btn').addEventListener('click', toggleIOPanel);
  document.getElementById('io-copy-btn').addEventListener('click', copyToClipboard);
  document.getElementById('io-load-btn').addEventListener('click', loadFromTextarea);
});
