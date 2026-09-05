// =====================================================================
// ViMove AI — LRD pipeline benchmark
// ---------------------------------------------------------------------
// Question: does the low-resolution pipeline actually make rep counting
// more accurate on a bad camera, or does it just sound clever?
//
// Method (SIMULATION — not a clinical study):
//   * Ground truth: 20 clean arm-raise repetitions of a shoulder/wrist
//     landmark pair at 30 fps.
//   * We degrade those coordinates the way a real camera degrades them at a
//     given resolution:
//        - quantisation : coordinates snap to the pixel grid (1/height)
//        - localisation : Gaussian error of ~1.5 px  (sigma = 1.5/height)
//        - gross errors : the landmark model occasionally puts a joint in the
//                         wrong place entirely (4-12 px away). This is the
//                         dominant failure mode on small/blurry subjects.
//        - dropouts     : BURSTS of frames with no detection at all (motion
//                         blur and low light last several frames, they are not
//                         independent per frame).
//     Everything scales with (480 / height)^2, i.e. with the pixel area lost.
//   * Two counters read the same degraded stream:
//        BASELINE : 5-frame moving average + fixed hysteresis + 350 ms
//                   cooldown  (what ViMove shipped before)
//        LRD      : median prefilter + One Euro stabiliser + gap bridging +
//                   noise-adaptive persistence + robust peak (this pipeline)
//   * Two scores, because a rep counter has two jobs:
//        - counting  : |counted - 20|, averaged over N random seeds
//        - measuring : how wrong the range-of-motion peak was. This is the
//                      number the clinical report is built on (consistency,
//                      fatigue decrement, left/right symmetry), so an inflated
//                      peak is not cosmetic - it changes what the
//                      physiotherapist reads.
//
// The ROI-upscaling stage is NOT simulated: it changes what the neural
// network sees, not the maths, and pretending otherwise would rig the
// result. The numbers below therefore come from stages 2-3 only.
//
// Run:  node bench/lowres_bench.mjs [--json]
// =====================================================================

import { LandmarkStabilizer, RepDetector } from "../app/static/game/lowres.js";

// ---------- deterministic RNG so the numbers are reproducible ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(rand) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- ground truth: 20 arm raises at 30 fps ----------
const FPS = 30, REPS = 20, REP_SECONDS = 1.6;
const TORSO = 0.25;   // normalised shoulder->hip distance
const PEAK = 0.42;    // peak armRatio at the top of the raise

function groundTruth(subjectScale = 1.0) {
  const frames = [];
  const torsoPx = TORSO * subjectScale;   // a person further away is smaller
  const total = Math.round(REPS * REP_SECONDS * FPS);
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    const phase = (t % REP_SECONDS) / REP_SECONDS;
    let v;
    if (phase < 0.42) v = PEAK * Math.sin((phase / 0.42) * Math.PI / 2);        // up
    else if (phase < 0.84) v = PEAK * Math.cos(((phase - 0.42) / 0.42) * Math.PI / 2); // down
    else v = 0;                                                                 // pause
    frames.push({
      t: t * 1000,
      sh: { x: 0.50, y: 0.45, visibility: 1 },
      wr: { x: 0.50, y: 0.45 - v * torsoPx, visibility: 1 },
      truth: v, torsoPx,
    });
  }
  return frames;
}

// ---------- camera model ----------
function degrade(frames, height, rand) {
  const q = 1 / height;                          // pixel size, normalised
  const sigma = 1.5 / height;                    // localisation error
  const lossFactor = Math.pow(480 / height, 2);  // how much pixel area we lost
  const pOutlier = Math.min(0.10, 0.006 * lossFactor);   // per landmark, per frame
  const pBurst = Math.min(0.05, 0.003 * lossFactor);     // start of a dropout burst
  let burst = 0;

  return frames.map(f => {
    if (burst > 0) { burst--; return { t: f.t, lms: null, truth: f.truth, torsoPx: f.torsoPx }; }
    if (rand() < pBurst) { burst = 1 + Math.floor(rand() * 4); return { t: f.t, lms: null, truth: f.truth, torsoPx: f.torsoPx }; }
    const jit = p => {
      let x = p.x + gauss(rand) * sigma;
      let y = p.y + gauss(rand) * sigma;
      if (rand() < pOutlier) {                   // gross mislocalisation
        const mag = (4 + rand() * 8) * q, ang = rand() * Math.PI * 2;
        x += Math.cos(ang) * mag; y += Math.sin(ang) * mag;
      }
      return { x: Math.round(x / q) * q, y: Math.round(y / q) * q, visibility: 1 };
    };
    return { t: f.t, lms: [jit(f.sh), jit(f.wr)], truth: f.truth, torsoPx: f.torsoPx };
  });
}

// ---------- the metric under test (same formula as game.js armRatio) ----------
const armRatio = (lms, torsoPx) => (lms ? (lms[0].y - lms[1].y) / torsoPx : null);

// ---------- thresholds: identical for both counters ----------
const BASE = { engage: 0.28, release: 0.05, dir: +1, noiseGain: 5 };

// ---------- counter A: what ViMove shipped before ----------
function countBaseline(stream) {
  let phase = "rest", reps = 0, buf = [], lastRepAt = -1e9;
  const peaks = [];  let cur = 0;
  for (const fr of stream) {
    const v = armRatio(fr.lms, fr.torsoPx);
    if (v == null) continue;                       // no reading: hold state
    buf.push(v); if (buf.length > 5) buf.shift();
    const m = buf.reduce((a, b) => a + b, 0) / buf.length;
    if (phase === "engaged") cur = Math.max(cur, m);
    if (phase === "rest" && m >= BASE.engage) { phase = "engaged"; cur = m; }
    else if (phase === "engaged" && m <= BASE.release) {
      phase = "rest";
      if (fr.t - lastRepAt >= 350) { reps++; lastRepAt = fr.t; peaks.push(cur); }
    }
  }
  return { reps, peaks };
}

// ---------- counter B: the LRD pipeline ----------
function countLRD(stream) {
  const stab = new LandmarkStabilizer();
  const det = new RepDetector(BASE);
  let reps = 0; const peaks = [];
  for (const fr of stream) {
    const lms = stab.process(fr.lms, fr.t);
    const vFast = armRatio(stab.fast, fr.torsoPx);   // decide on the low-lag rail
    const vSmooth = armRatio(lms, fr.torsoPx);       // measure on the smooth rail
    if (det.update(vFast, fr.t, stab.jitter, vSmooth) === "rep") {
      reps++; peaks.push(det.lastPeak);
    }
  }
  return { reps, peaks };
}

// ---------- run ----------
const CASES = [
  { label: "1280x720 · yakin", h: 720, scale: 1.00 },
  { label: "640x480 · yakin", h: 480, scale: 1.00 },
  { label: "640x480 · uzak", h: 480, scale: 0.45 },
  { label: "320x240 · yakin", h: 240, scale: 1.00 },
  { label: "320x240 · uzak", h: 240, scale: 0.45 },
  { label: "160x120 · uzak", h: 120, scale: 0.45 },
];
const SEEDS = 60;
const rows = [];
const mae = (peaks) => peaks.length
  ? peaks.reduce((s, p) => s + Math.abs(p - PEAK), 0) / peaks.length : null;

for (const c of CASES) {
  const truth = groundTruth(c.scale);
  let eB = 0, eL = 0, cB = 0, cL = 0, aB = 0, aL = 0, nB = 0, nL = 0;
  for (let s = 0; s < SEEDS; s++) {
    const rand = rng(1000 + s * 7919 + c.h + Math.round(c.scale * 100));
    const stream = degrade(truth, c.h, rand);
    const b = countBaseline(stream), l = countLRD(stream);
    eB += Math.abs(b.reps - REPS); eL += Math.abs(l.reps - REPS);
    cB += b.reps; cL += l.reps;
    const mb = mae(b.peaks), ml = mae(l.peaks);
    if (mb != null) { aB += mb; nB++; }
    if (ml != null) { aL += ml; nL++; }
  }
  rows.push({
    case: c.label, height: c.h, subjectScale: c.scale, trueReps: REPS,
    baselineMeanCount: +(cB / SEEDS).toFixed(2),
    lrdMeanCount: +(cL / SEEDS).toFixed(2),
    baselineAccuracy: +(100 * (1 - (eB / SEEDS) / REPS)).toFixed(1),
    lrdAccuracy: +(100 * (1 - (eL / SEEDS) / REPS)).toFixed(1),
    // how wrong the measured movement SIZE was (this drives the report scores)
    baselineAmpErrorPct: nB ? +(100 * (aB / nB) / PEAK).toFixed(1) : null,
    lrdAmpErrorPct: nL ? +(100 * (aL / nL) / PEAK).toFixed(1) : null,
  });
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log(`
ViMove AI — LRD benchmark (${REPS} gercek tekrar, ${SEEDS} tekrarli simulasyon)
`);
console.log(pad("Senaryo", 20) + padL("Sayim B", 10) + padL("Sayim LRD", 12) +
            padL("Genlik hatasi B", 18) + padL("Genlik hatasi LRD", 20));
console.log("-".repeat(80));
for (const r of rows) {
  console.log(pad(r.case, 20) + padL("%" + r.baselineAccuracy, 10) + padL("%" + r.lrdAccuracy, 12) +
              padL("%" + r.baselineAmpErrorPct, 18) + padL("%" + r.lrdAmpErrorPct, 20));
}

const hard = rows.filter(r => r.subjectScale < 1);
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`
Zor senaryolar (kullanici uzakta):`);
console.log(`  sayim dogrulugu : baseline %${avg(hard.map(r => r.baselineAccuracy)).toFixed(1)} -> LRD %${avg(hard.map(r => r.lrdAccuracy)).toFixed(1)}`);
console.log(`  genlik hatasi   : baseline %${avg(hard.map(r => r.baselineAmpErrorPct)).toFixed(1)} -> LRD %${avg(hard.map(r => r.lrdAmpErrorPct)).toFixed(1)}
`);

if (process.argv.includes("--json")) {
  const fs = await import("node:fs");
  fs.writeFileSync(new URL("./lowres_bench_results.json", import.meta.url),
    JSON.stringify({ generated: new Date().toISOString(), seeds: SEEDS, trueReps: REPS, rows }, null, 2));
  console.log("bench/lowres_bench_results.json yazildi.");
}
