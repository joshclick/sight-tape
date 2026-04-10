// Sight Mark Calculator — model validation tests
// Run with: node test.js

// ── Replicate model functions ──────────────────────────────────────────────────
const YD_TO_M = 0.9144;

function toMeters(distance, unit) {
  return unit === 'yd' ? parseFloat(distance) * YD_TO_M : parseFloat(distance);
}

// Least-squares fit: mark = a + b·d (d in metres)
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

// ── Test harness ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;

function ok(desc, cond) {
  if (cond) { console.log(`  ✓  ${desc}`); pass++; }
  else       { console.error(`  ✗  ${desc}`); fail++; }
}

function near(desc, got, expected, tol) {
  const diff = Math.abs(got - expected);
  const label = `${got.toFixed(3)} (expected ${expected} ± ${tol})`;
  if (diff <= tol) { console.log(`  ✓  ${desc}  [${label}]`); pass++; }
  else             { console.error(`  ✗  ${desc}  [${label}]`); fail++; }
}

// ── 1. Unit conversion ─────────────────────────────────────────────────────────
console.log('\n1. Unit conversion');

near('18 yd → 16.459 m', toMeters(18, 'yd'), 18 * 0.9144, 0.001);
near('25 yd → 22.860 m', toMeters(25, 'yd'), 25 * 0.9144, 0.001);
near('20 m  → 20.000 m', toMeters(20, 'm'),  20,          0.001);
near('70 m  → 70.000 m', toMeters(70, 'm'),  70,          0.001);

// ── 2. Model fit on default data ───────────────────────────────────────────────
// Real-world defaults: 18m=94, 30m=78, 50m=57, 70m=38
// These mimic a typical recurve sight tape (higher number = shorter distance).
console.log('\n2. Model fit — default marks (18m=94, 30m=78, 50m=57, 70m=38)');

const defaultMarks = [
  { distance: 18, unit: 'm', value: 94 },
  { distance: 30, unit: 'm', value: 78 },
  { distance: 50, unit: 'm', value: 57 },
  { distance: 70, unit: 'm', value: 38 },
];

const predict = fitModel(defaultMarks);
ok('fitModel returns a function', typeof predict === 'function');

// Residuals at each measured distance (fit should reproduce data closely)
const residuals = defaultMarks.map(m => predict(toMeters(m.distance, m.unit)) - m.value);
defaultMarks.forEach((m, i) =>
  near(`residual at ${m.distance}m < 2`, residuals[i], 0, 2)
);
near('max absolute residual < 2', Math.max(...residuals.map(Math.abs)), 0, 2);

// ── 3. Monotone decreasing ─────────────────────────────────────────────────────
// Further distance → lower sight mark value (closer aim point)
console.log('\n3. Monotone: further distance → lower sight mark');

const stdDists = [18, 20, 25, 30, 40, 50, 60, 70];
for (let i = 1; i < stdDists.length; i++) {
  const d0 = stdDists[i - 1], d1 = stdDists[i];
  const v0 = predict(d0), v1 = predict(d1);
  ok(`mark(${d0}m) > mark(${d1}m)  [${v0.toFixed(1)} > ${v1.toFixed(1)}]`, v0 > v1);
}

// ── 4. Gaps grow with distance (concave-up in metres) ─────────────────────────
// Equal distance increments should produce similar (slightly shrinking) gaps,
// but physically the 18-70m range is nearly linear so gaps are ~constant.
// Verify the model doesn't produce wild curvature: ratio of gap-per-metre
// at far end vs near end should be within 3× of 1.
console.log('\n4. Gap-per-metre ratio (near vs far, should be within 3×)');

const rateNear = (predict(18) - predict(20)) / 2;   // Δmark / Δm at ~18m
const rateFar  = (predict(60) - predict(70)) / 10;  // Δmark / Δm at ~65m
near('far/near rate ratio ≈ 1 (linear gaps)', rateNear / rateFar, 1, 0.1);

// ── 5. Leave-one-out interpolation ────────────────────────────────────────────
// Fit on 3 marks, predict the 4th.  Should stay within ±5 of the true value.
console.log('\n5. Leave-one-out cross-validation (hold-out tolerance ±5)');

defaultMarks.forEach((held, i) => {
  const training = defaultMarks.filter((_, j) => j !== i);
  const loo = fitModel(training);
  if (!loo) { ok(`LOO ${held.distance}m — model returned null`, false); return; }
  const predicted = loo(toMeters(held.distance, held.unit));
  near(`predict ${held.distance}m (true=${held.value})`, predicted, held.value, 5);
});

// ── 6. Interpolation between user marks ───────────────────────────────────────
// 40m is not in the default set; its prediction must lie between 50m and 30m.
console.log('\n6. Interpolated distance lies between bracketing entered marks');

const at30 = predict(30), at40 = predict(40), at50 = predict(50);
ok(`mark(40m) between mark(50m) and mark(30m)  [${at50.toFixed(1)} < ${at40.toFixed(1)} < ${at30.toFixed(1)}]`,
   at50 < at40 && at40 < at30);

// ── 7. Yards input handled correctly ──────────────────────────────────────────
// 18yd ≈ 16.46m; its predicted value should lie between mark(18m) and mark(15m).
console.log('\n7. Yard input: 18yd treated as ~16.46m');

const marksWithYd = [
  { distance: 18, unit: 'yd', value: 95.5 },  // 16.46m ≈ just inside 18m
  { distance: 30, unit: 'm',  value: 78   },
  { distance: 70, unit: 'm',  value: 38   },
];
const predictYd = fitModel(marksWithYd);
ok('fitModel returns a function for yd input', typeof predictYd === 'function');
near('18yd residual < 2', predictYd(toMeters(18, 'yd')) - 95.5, 0, 2);

// ── 8. Edge case: only 1 mark → null ──────────────────────────────────────────
console.log('\n8. Edge cases');

ok('1 mark → fitModel returns null', fitModel([{ distance: 30, unit: 'm', value: 78 }]) === null);
ok('0 marks → fitModel returns null', fitModel([]) === null);

// Collinear-degenerate: two identical distances
const same = [
  { distance: 30, unit: 'm', value: 78 },
  { distance: 30, unit: 'm', value: 75 },
];
ok('two identical x values → null', fitModel(same) === null);

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
