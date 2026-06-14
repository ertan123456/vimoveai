// ViMove — AI exercise detection engine
// MediaPipe Tasks Vision (hand / face / pose) in the browser.
//
// Design goals (v7):
//  - Scale & distance invariant metrics (normalized by body/hand/face size)
//  - Hysteresis on every detector (separate "engage" and "release" thresholds)
//    so a held position never flickers between states
//  - One generic rep state machine (engage -> release = 1 rep)
//  - Consistent, user-perspective left/right (mirror-corrected once, used everywhere)
//  - Only the model needed for the current exercise runs each frame (higher FPS)
//  - Temporal smoothing + time-based debounce to reject noise/double counts

import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8";

// ---------------- DOM ----------------
const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const stageEl = document.getElementById("stage");
const btnStart = document.getElementById("btnStart");
const btnReset = document.getElementById("btnReset");
const statusEl = document.getElementById("status");
const infoEl = document.getElementById("info");
const fpsEl = document.getElementById("fps");
const liveStateEl = document.getElementById("liveState");
const exerciseNameEl = document.getElementById("exerciseName");
const repsEl = document.getElementById("reps");
const targetEl = document.getElementById("target");
const barEl = document.getElementById("bar");
const planListEl = document.getElementById("planList");
const diagEl = document.getElementById("diag");
const hintEl = document.getElementById("hint");
const reportEl = document.getElementById("report");

canvas.width = 640; canvas.height = 480;

// ---------------- Config ----------------
const SMOOTHING_WINDOW = 5;     // frames averaged per metric
const REP_COOLDOWN_MS  = 350;   // min time between two counted reps
const CALIBRATION_FRAMES = 45;  // sit-to-stand standing reference
const MIN_VISIBILITY = 0.5;     // pose landmark confidence gate

// Sit-to-stand thresholds (ratios of standing reference height)
const SIT_RATIO = 0.80, STAND_RATIO = 0.92;
const KNEE_SIT_ANGLE = 120, KNEE_STAND_ANGLE = 155;

// ---------------- Exercise plan ----------------
// kind drives which model runs and which metric is computed.
// DEFAULT_PLAN is the fallback if no server-generated program is injected.
const DEFAULT_PLAN = [
  { ad: "Left Hand Open - Close",  hedef: 10, kind: "hand",     side: "left"  },
  { ad: "Right Hand Open - Close", hedef: 10, kind: "hand",     side: "right" },
  { ad: "Mouth Open - Close",      hedef: 5,  kind: "mouth"                    },
  { ad: "Right Eye Blink",         hedef: 5,  kind: "blink",    side: "right" },
  { ad: "Left Eye Blink",          hedef: 5,  kind: "blink",    side: "left"  },
  { ad: "Right Leg Extension",     hedef: 8,  kind: "leg",      side: "right" },
  { ad: "Left Leg Extension",      hedef: 8,  kind: "leg",      side: "left"  },
  { ad: "Right Arm Raise",         hedef: 5,  kind: "arm",      side: "right" },
  { ad: "Left Arm Raise",          hedef: 5,  kind: "arm",      side: "left"  },
  { ad: "Sit Down, Stand Up",      hedef: 8,  kind: "sitstand"                },
];

// Threshold table: dir +1 => engaged when value >= engage, rest when value <= release.
//                  dir -1 => engaged when value <= engage, rest when value >= release.
const THRESH = {
  hand:  { engage: 3.0, release: 1.5, dir: +1 },  // extended-finger count (0..4)
  mouth: { engage: 0.45, release: 0.25, dir: +1 }, // lip gap / mouth width
  blink: { engage: 0.16, release: 0.26, dir: -1 }, // eye aspect ratio (closed = low)
  leg:   { engage: 0.85, release: 0.45, dir: +1 }, // lateral ankle offset / hip width
  arm:   { engage: 0.28, release: 0.05, dir: +1 }, // (shoulderY - wristY) / torso
};

// Build the active plan from the server-generated program (falls back to default).
function loadPlan() {
  try {
    const el = document.getElementById("program-data");
    if (el && el.textContent.trim()) {
      const prog = JSON.parse(el.textContent);
      if (prog && Array.isArray(prog.exercises) && prog.exercises.length) {
        return prog.exercises.map(e => ({
          ad: e.ad, hedef: e.hedef, kind: e.kind,
          side: (e.side === undefined ? null : e.side), rationale: e.rationale || ""
        }));
      }
    }
  } catch (err) { console.warn("Program data parse failed; using default plan.", err); }
  return DEFAULT_PLAN;
}
const PLAN = loadPlan();

// Program meta (for the progress history)
function loadProgramInfo() {
  try {
    const el = document.getElementById("program-data");
    if (el && el.textContent.trim()) {
      const p = JSON.parse(el.textContent);
      return { disease: p.disease || "", name: p.name || "" };
    }
  } catch (e) {}
  return { disease: "", name: "" };
}
const PROGRAM_INFO = loadProgramInfo();

// ---------------- Localization + voice ----------------
const btnVoice = document.getElementById("btnVoice");
const voiceLabelEl = document.getElementById("voiceLabel");

const LOC = {
  en: {
    side: { left: "Left", right: "Right" },
    exbase: { hand: "Hand Open - Close", arm: "Arm Raise", leg: "Leg Extension", mouth: "Mouth Open - Close", blink: "Eye Blink", sitstand: "Sit Down, Stand Up" },
    instruct: { hand: "Open your hand wide, then make a fist.", arm: "Raise your arm above your shoulder, then lower it.", leg: "Move your leg out to the side, then back.", mouth: "Open your mouth, then close it.", blink: "Close your eye, then open it.", sitstand: "Stand still to calibrate, then sit down and stand up." },
    label: { hand: { left: "Left hand", right: "Right hand" }, mouth: "Mouth", blink: { left: "Left eye", right: "Right eye" }, leg: { left: "Left leg", right: "Right leg" }, arm: { left: "Left arm", right: "Right arm" }, posture: "Posture" },
    st: { open: "Open", closed: "Closed", extended: "Extended", resting: "Resting", raised: "Raised", down: "Down", seated: "Seated", standing: "Standing", eyeClosed: "Closed", eyeOpen: "Open", dash: "—" },
    calib: "Calibrating… stand still",
    nextEx: "Next exercise", done: "Well done — you finished all the exercises!", voice: "Voice",
    started: "Follow the on-screen exercise — reps are counted automatically.",
    counted: (n, t) => `counted (${n}/${t})`, reset: "Counter reset.",
    status: { starting: "Starting camera…", requesting: "Requesting camera access…", tracking: "Tracking", error: "Error", completed: "Completed", running: "Camera running", calib: "Stand upright for the first 5 seconds so we can calibrate.", errInfo: "We couldn't start the camera or load the AI models. Check camera permissions and try again.", errStage: "Couldn't start the camera" }
  },
  tr: {
    side: { left: "Sol", right: "Sağ" },
    exbase: { hand: "El Aç - Kapat", arm: "Kol Kaldırma", leg: "Bacak Açma", mouth: "Ağız Aç - Kapat", blink: "Göz Kırpma", sitstand: "Otur - Kalk" },
    instruct: { hand: "Elini iyice aç, sonra yumruk yap.", arm: "Kolunu omzunun üstüne kaldır, sonra indir.", leg: "Bacağını yana aç, sonra geri getir.", mouth: "Ağzını aç, sonra kapat.", blink: "Gözünü kapat, sonra aç.", sitstand: "Sabit dur, sonra otur ve kalk." },
    label: { hand: { left: "Sol el", right: "Sağ el" }, mouth: "Ağız", blink: { left: "Sol göz", right: "Sağ göz" }, leg: { left: "Sol bacak", right: "Sağ bacak" }, arm: { left: "Sol kol", right: "Sağ kol" }, posture: "Duruş" },
    st: { open: "Açık", closed: "Kapalı", extended: "Açık", resting: "Dinlenme", raised: "Yukarıda", down: "Aşağıda", seated: "Oturuyor", standing: "Ayakta", eyeClosed: "Kapalı", eyeOpen: "Açık", dash: "—" },
    calib: "Kalibrasyon… sabit dur",
    nextEx: "Sıradaki egzersiz", done: "Tebrikler — tüm egzersizleri tamamladın!", voice: "Ses",
    started: "Ekrandaki egzersizi yap — tekrarlar otomatik sayılır.",
    counted: (n, t) => `sayıldı (${n}/${t})`, reset: "Sayaç sıfırlandı.",
    status: { starting: "Kamera başlatılıyor…", requesting: "Kamera izni isteniyor…", tracking: "Takip ediyor", error: "Hata", completed: "Tamamlandı", running: "Kamera açık", calib: "İlk 5 saniye dik dur ki kalibrasyon yapabilelim.", errInfo: "Kamerayı veya yapay zeka modellerini başlatamadık. Kamera iznini kontrol edip tekrar dene.", errStage: "Kamera başlatılamadı" }
  }
};
function LANG() { return (window.viI18n && window.viI18n.lang === "tr") ? "tr" : "en"; }
function loc() { return LOC[LANG()]; }
function exName(ex) {
  const g = loc(); const nm = g.exbase[ex.kind] || ex.ad || ex.kind;
  return ex.side ? `${g.side[ex.side]} ${nm}` : nm;
}

// Voice guidance (Web Speech API)
let voiceOn = (localStorage.getItem("vimove:voice") || "1") === "1";
const speechOK = () => voiceOn && ("speechSynthesis" in window);
const langCode = () => (LANG() === "tr" ? "tr-TR" : "en-US");
function announce(text) {
  if (!speechOK()) return;
  try { const u = new SpeechSynthesisUtterance(text); u.lang = langCode(); u.rate = 0.95; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
}
function sayCount(n) {
  if (!speechOK()) return;
  try { const u = new SpeechSynthesisUtterance(String(n)); u.lang = langCode(); u.rate = 1.0; speechSynthesis.speak(u); } catch (e) {}
}
function announceExercise(prefix) {
  const g = loc(), ex = PLAN[ix];
  announce((prefix ? prefix + ": " : "") + exName(ex) + ". " + (g.instruct[ex.kind] || ""));
}
function updateVoiceBtn() {
  if (voiceLabelEl) voiceLabelEl.textContent = loc().voice;
  if (btnVoice) btnVoice.setAttribute("aria-pressed", voiceOn ? "true" : "false");
}
if (btnVoice) btnVoice.addEventListener("click", () => {
  voiceOn = !voiceOn;
  localStorage.setItem("vimove:voice", voiceOn ? "1" : "0");
  if (!voiceOn && "speechSynthesis" in window) speechSynthesis.cancel();
  updateVoiceBtn();
});

// ---------------- Runtime state ----------------
let ix = 0;
let reps = 0;
let running = false;
let handLandmarker, faceLandmarker, poseLandmarker;
let lastTime = performance.now(), frameCount = 0;

// rep state machine
let phase = "rest";                 // "rest" | "engaged"
let smooth = [];                    // metric smoothing buffer
let lastRepAt = 0;

// sit-to-stand calibration
let standRef = null, calibCount = 0, heightBuf = [];
let lastHeight = null;          // smoothed nose-ankle height (for sit depth)

// ---------------- Movement-quality scoring state ----------------
// We log every counted rep's peak amplitude (ROM) and duration, then compute
// evidence-relevant summaries: amplitude consistency, decrement (sequence
// effect), tempo, and left/right symmetry. These are relative, within-person
// screening indicators — NOT clinical joint angles or a diagnosis.
let sessionLog = [];            // one entry per plan exercise: {..., reps:[{peak,dur}]}
let sessionStart = 0;
let engagedPeak = 0, engagedStart = 0;

// ---------------- Math helpers ----------------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function angle(a, b, c) {                 // angle at b (a-b-c) in degrees
  const bax = a.x - b.x, bay = a.y - b.y, bcx = c.x - b.x, bcy = c.y - b.y;
  const d = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (!d) return 180;
  return Math.acos(clamp((bax * bcx + bay * bcy) / d, -1, 1)) * 180 / Math.PI;
}
const avg = arr => arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
function median(arr) {
  const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
}
const vis = lm => (lm && lm.visibility === undefined ? 1 : (lm ? lm.visibility : 0));

// Map MediaPipe's handedness label to the user's actual side. Verified live:
// in our pipeline the label already matches the user's hand (MediaPipe "Left"
// => user's LEFT hand). Used everywhere, so counting + display stay consistent.
const userSide = mpLabel => (mpLabel === "Right" ? "right" : "left");

// ---------------- Metrics (scale invariant) ----------------
// HAND: count extended fingers (tip farther from wrist than its PIP joint).
function handExtendedCount(lm) {
  const wrist = lm[0];
  const fingers = [[8, 6], [12, 10], [16, 14], [20, 18]]; // index, middle, ring, pinky
  let count = 0;
  for (const [tip, pip] of fingers) {
    if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.05) count++;
  }
  // thumb: tip(4) vs IP(3) horizontal-ish extension relative to palm
  if (dist(lm[4], wrist) > dist(lm[2], wrist) * 1.05) count += 0; // ignore thumb (noisy) -> keep 0..4
  return count;
}
// HAND continuous openness (for amplitude): mean fingertip distance from wrist,
// normalized by palm size (wrist->middle-finger MCP). Scale invariant.
function handOpenness(lm) {
  const wrist = lm[0];
  const palm = dist(wrist, lm[9]) || 1e-6;
  const tips = [8, 12, 16, 20];
  return avg(tips.map(t => dist(lm[t], wrist) / palm));
}
// MOUTH: vertical inner-lip gap normalized by mouth width.
function mouthRatio(f) {
  const gap = dist(f[13], f[14]);
  const width = dist(f[61], f[291]) || 1e-6;
  return gap / width;
}
// EYE ASPECT RATIO (EAR): vertical / horizontal. side = user's side.
function eyeEAR(f, side) {
  // indices kept consistent with original working version
  const idx = side === "right"
    ? { up: 159, dn: 145, l: 33,  r: 133 }
    : { up: 386, dn: 374, l: 362, r: 263 };
  const v = dist(f[idx.up], f[idx.dn]);
  const h = dist(f[idx.l], f[idx.r]) || 1e-6;
  return v / h;
}
// LEG abduction: lateral ankle offset from hip, normalized by hip width.
function legRatio(p, side) {
  const hip = side === "right" ? p[24] : p[23];
  const ank = side === "right" ? p[28] : p[27];
  if (vis(hip) < MIN_VISIBILITY || vis(ank) < MIN_VISIBILITY) return null;
  const hipW = dist(p[23], p[24]) || 1e-6;
  return Math.abs(ank.x - hip.x) / hipW;
}
// ARM raise: how far the wrist is above the shoulder, normalized by torso length.
function armRatio(p, side) {
  const sh  = side === "right" ? p[12] : p[11];
  const wr  = side === "right" ? p[16] : p[15];
  const hip = side === "right" ? p[24] : p[23];
  if (vis(sh) < MIN_VISIBILITY || vis(wr) < MIN_VISIBILITY) return null;
  const torso = dist(sh, hip) || 1e-6;
  return (sh.y - wr.y) / torso;     // positive when wrist above shoulder
}

// ---------------- Generic engaged/rest decision ----------------
function decidePhase(kind, value) {
  if (value == null || Number.isNaN(value)) return null; // no reliable reading
  smooth.push(value);
  if (smooth.length > SMOOTHING_WINDOW) smooth.shift();
  const v = avg(smooth);
  const t = THRESH[kind];
  const engaged = t.dir > 0 ? v >= t.engage : v <= t.engage;
  const rested  = t.dir > 0 ? v <= t.release : v >= t.release;
  if (phase === "rest" && engaged) phase = "engaged";
  else if (phase === "engaged" && rested) { phase = "rest"; return "rep"; }
  return phase;
}

// ---------------- Sit-to-stand (special: calibration + knee angle) ----------------
function sitStandRep(p) {
  const nose = p[0], aR = p[28], aL = p[27];
  if (vis(nose) < MIN_VISIBILITY || vis(aR) < MIN_VISIBILITY || vis(aL) < MIN_VISIBILITY) return null;
  const ankleY = (aR.y + aL.y) / 2;
  const height = Math.abs(nose.y - ankleY);

  heightBuf.push(height);
  if (heightBuf.length > SMOOTHING_WINDOW) heightBuf.shift();
  const h = avg(heightBuf);
  lastHeight = h;

  if (standRef == null) {
    calibCount++;
    if (calibCount >= CALIBRATION_FRAMES) standRef = Math.max(median(heightBuf), 0.25);
    return "calibrating";
  }

  const kneeR = angle(p[24], p[26], p[28]);
  const kneeL = angle(p[23], p[25], p[27]);
  const knee = Math.min(kneeR, kneeL);

  if (phase === "rest" && (h < standRef * SIT_RATIO || knee < KNEE_SIT_ANGLE)) {
    phase = "engaged"; // seated
  } else if (phase === "engaged" && h > standRef * STAND_RATIO && knee > KNEE_STAND_ANGLE) {
    phase = "rest";
    return "rep";
  }
  return phase;
}

// ---------------- Live readout (same source as the counter) ----------------
function renderLive(ex, results) {
  const g = loc();
  const chip = (label, on, onText, offText) =>
    `<span class="state-chip ${on ? 'is-on' : ''}">${label}: <b>${on ? onText : offText}</b></span>`;
  const on = phase === "engaged";

  if (ex.kind === "hand") {
    const hands = results?.hand?.landmarks || [];
    const handed = results?.hand?.handedness || [];
    let left = null, right = null;
    for (let i = 0; i < hands.length; i++) {
      const side = userSide(handed[i]?.[0]?.categoryName || "");
      const open = handExtendedCount(hands[i]) >= 2;
      if (side === "left") left = open; else right = open;
    }
    liveStateEl.innerHTML =
      chip(g.label.hand.left,  left  === true, g.st.open, left  === null ? g.st.dash : g.st.closed) +
      chip(g.label.hand.right, right === true, g.st.open, right === null ? g.st.dash : g.st.closed);
  } else if (ex.kind === "mouth") {
    liveStateEl.innerHTML = chip(g.label.mouth, on, g.st.open, g.st.closed);
  } else if (ex.kind === "blink") {
    liveStateEl.innerHTML = chip(g.label.blink[ex.side], on, g.st.eyeClosed, g.st.eyeOpen);
  } else if (ex.kind === "leg") {
    liveStateEl.innerHTML = chip(g.label.leg[ex.side], on, g.st.extended, g.st.resting);
  } else if (ex.kind === "arm") {
    liveStateEl.innerHTML = chip(g.label.arm[ex.side], on, g.st.raised, g.st.down);
  } else if (ex.kind === "sitstand") {
    if (standRef == null) {
      liveStateEl.innerHTML = `<span class="state-chip warn">${g.calib} (${calibCount}/${CALIBRATION_FRAMES})</span>`;
    } else {
      liveStateEl.innerHTML = chip(g.label.posture, on, g.st.seated, g.st.standing);
    }
  }
}

// ---------------- UI ----------------
function pct() { return Math.min(100, Math.round((reps / PLAN[ix].hedef) * 100)); }

function renderPlan(activeIdx) {
  planListEl.innerHTML = PLAN.map((e, i) => {
    const cls = activeIdx == null ? "" : (i < activeIdx ? "done" : (i === activeIdx ? "active" : ""));
    const tick = (activeIdx != null && i < activeIdx) ? "✓" : "";
    const repsWord = LANG() === "tr" ? "tekrar" : "reps";
    return `<li class="${cls}"><span class="tick">${tick}</span><span>${exName(e)}</span><span class="ex-target">${e.hedef} ${repsWord}</span></li>`;
  }).join("");
}

function setExerciseUI() {
  const ex = PLAN[ix];
  exerciseNameEl.textContent = exName(ex);
  targetEl.textContent = ex.hedef;
  repsEl.textContent = reps;
  barEl.style.width = pct() + "%";
  renderPlan(ix);
  hintEl.textContent = loc().instruct[ex.kind] || "";
}

function resetExerciseState() {
  phase = "rest";
  smooth = [];
  standRef = null; calibCount = 0; heightBuf = [];
  lastRepAt = 0;
}

function resetExercise() {
  reps = 0;
  resetExerciseState();
  if (sessionLog[ix]) sessionLog[ix].reps = [];
  setExerciseUI();
}

function nextExerciseAuto() {
  if (ix < PLAN.length - 1) {
    ix += 1;
    resetExercise();
    infoEl.textContent = `${loc().nextEx}: ${exName(PLAN[ix])}`;
    announceExercise(loc().nextEx);
  } else {
    running = false;
    infoEl.textContent = loc().done;
    statusEl.textContent = loc().status.completed; statusEl.className = "pill ok";
    renderPlan(PLAN.length); // mark all done
    announce(loc().done);
    showReport();
  }
}

function countRep(now) {
  now = now || performance.now();
  if (now - lastRepAt < REP_COOLDOWN_MS) return;
  lastRepAt = now;
  // Log this rep's quality BEFORE any exercise advancement.
  const dur = engagedStart ? (now - engagedStart) : 0;
  if (sessionLog[ix]) sessionLog[ix].reps.push({ peak: engagedPeak, dur });
  reps++;
  repsEl.textContent = reps;
  barEl.style.width = pct() + "%";
  infoEl.textContent = `${exName(PLAN[ix])} — ${loc().counted(reps, PLAN[ix].hedef)}`;
  if (reps >= PLAN[ix].hedef) nextExerciseAuto();
  else sayCount(reps);
}

// ---------------- Movement-quality report ----------------
const stdev = (arr, m) => Math.sqrt(avg(arr.map(x => (x - m) ** 2)));

function computeReport() {
  const KIND_LABEL = { hand: "Hands", arm: "Arms", leg: "Legs", blink: "Eyes" };

  const exStats = sessionLog.filter(e => e.reps.length > 0).map(e => {
    const peaks = e.reps.map(r => r.peak).filter(v => v > 0);
    const durs  = e.reps.map(r => r.dur / 1000).filter(v => v > 0.1 && v < 30);
    const m = avg(peaks);
    const cv = m > 0 ? stdev(peaks, m) / m : 0;
    const consistency = Math.round(100 * clamp(1 - cv, 0, 1));
    const tempo = durs.length ? +avg(durs).toFixed(1) : null;
    let decrement = null;
    if (peaks.length >= 4) {                     // sequence effect: first vs last third
      const k = Math.max(1, Math.round(peaks.length / 3));
      const first = avg(peaks.slice(0, k)), last = avg(peaks.slice(-k));
      decrement = first > 0 ? Math.round(100 * (first - last) / first) : 0;
    }
    return { ad: e.ad, kind: e.kind, side: e.side, count: e.reps.length,
             target: e.target, meanPeak: m, consistency, tempo, decrement };
  });

  // Left/right symmetry per paired movement
  const byKind = {};
  for (const s of exStats) if (s.side) (byKind[s.kind] ||= {})[s.side] = s;
  const pairs = [];
  for (const kind in byKind) {
    const L = byKind[kind].left, R = byKind[kind].right;
    if (L && R && L.meanPeak > 0 && R.meanPeak > 0) {
      const sym = Math.round(100 * (1 - Math.abs(R.meanPeak - L.meanPeak) / (R.meanPeak + L.meanPeak)));
      pairs.push({ kind, label: KIND_LABEL[kind] || kind, symmetry: sym,
                   weaker: R.meanPeak < L.meanPeak ? "right" : "left" });
    }
  }

  const totalReps   = sessionLog.reduce((s, e) => s + e.reps.length, 0);
  const totalTarget = sessionLog.reduce((s, e) => s + e.target, 0);
  const completion  = totalTarget ? totalReps / totalTarget : 0;
  const meanConsistency = exStats.length ? avg(exStats.map(s => s.consistency)) : 0;
  const meanSymmetry    = pairs.length ? avg(pairs.map(p => p.symmetry)) : 100;
  const overall = Math.round(clamp(40 * completion + 0.3 * meanConsistency + 0.3 * meanSymmetry, 0, 100));

  const notes = [];
  for (const p of pairs) if (p.symmetry < 80)
    notes.push({ type: "warn", text: `${p.label}: noticeable left/right difference (${p.symmetry}% symmetry) — your ${p.weaker} side moved smaller. Worth sharing with a therapist.` });
  for (const s of exStats) if (s.decrement != null && s.decrement >= 20)
    notes.push({ type: "warn", text: `${s.ad}: movement got about ${s.decrement}% smaller across the set — the "sequence effect" commonly seen in Parkinson's.` });
  for (const s of exStats) if (s.consistency < 55)
    notes.push({ type: "info", text: `${s.ad}: movement size varied quite a bit (${s.consistency}% consistency).` });
  if (!notes.length)
    notes.push({ type: "good", text: "Movements were steady and symmetric throughout — great control!" });

  return {
    durationMin: +(((performance.now() - sessionStart) / 60000)).toFixed(1),
    totalReps, totalTarget, overall,
    meanSymmetry: Math.round(meanSymmetry), meanConsistency: Math.round(meanConsistency),
    exercises: exStats, pairs, notes, when: new Date().toISOString()
  };
}

function renderReport(rep) {
  if (!reportEl) return;
  const tempo = t => (t == null ? "—" : t + "s");
  const ampCell = s =>
    s.decrement == null ? "—" : (s.decrement > 0 ? `-${s.decrement}% size` : "steady size");

  const tiles = `
    <div class="report-tiles">
      <div class="tile"><span class="tile-val">${rep.totalReps}/${rep.totalTarget}</span><span class="tile-lab">Reps completed</span></div>
      <div class="tile"><span class="tile-val">${rep.durationMin} min</span><span class="tile-lab">Session time</span></div>
      <div class="tile"><span class="tile-val">${rep.pairs.length ? rep.meanSymmetry + "%" : "—"}</span><span class="tile-lab">L/R symmetry</span></div>
      <div class="tile"><span class="tile-val">${rep.meanConsistency}%</span><span class="tile-lab">Consistency</span></div>
    </div>`;

  const rows = rep.exercises.map(s => `
    <div class="rrow">
      <span class="rrow-name">${s.ad}</span>
      <span class="rrow-cell">${s.count}/${s.target}</span>
      <span class="rrow-cell">${tempo(s.tempo)}/rep</span>
      <span class="rrow-cell">${s.consistency}% steady</span>
      <span class="rrow-cell ${s.decrement != null && s.decrement >= 20 ? 'is-flag' : ''}">${ampCell(s)}</span>
    </div>`).join("");

  const notes = rep.notes.map(n =>
    `<li class="note note--${n.type}"><span class="note-dot"></span><span>${n.text}</span></li>`).join("");

  reportEl.innerHTML = `
    <div class="card report-card">
      <div class="report-top">
        <div><span class="eyebrow">Session report</span><h2 style="margin:0">Your movement analysis</h2></div>
        <div class="score-badge"><b>${rep.overall}</b><span>/100</span></div>
      </div>
      ${tiles}
      <h3 class="report-h">By exercise</h3>
      <div class="report-rows">
        <div class="rrow rrow-head">
          <span class="rrow-name">Exercise</span><span class="rrow-cell">Reps</span>
          <span class="rrow-cell">Tempo</span><span class="rrow-cell">Consistency</span><span class="rrow-cell">Amplitude</span>
        </div>
        ${rows}
      </div>
      <h3 class="report-h">What we noticed</h3>
      <ul class="report-notes">${notes}</ul>
      <div class="notice notice--warn" style="margin-top:18px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>This is a self-tracking screening summary from camera-based motion estimation — not a clinical measurement or diagnosis. Amplitude is <strong>relative</strong> (most useful compared against your own past sessions). Please share results with your clinician.</span>
      </div>
      <div class="report-actions">
        <a href="/session" class="btn btn--primary">Do it again</a>
        <a href="/" class="btn btn--secondary">Finish</a>
      </div>
    </div>`;
}

function showReport() {
  const rep = computeReport();
  try { localStorage.setItem("vimove:lastReport", JSON.stringify(rep)); } catch (e) {}
  // Append a compact entry to the progress history (for the /progress dashboard)
  try {
    const hist = JSON.parse(localStorage.getItem("vimove:history") || "[]");
    hist.push({
      when: rep.when, disease: PROGRAM_INFO.disease, name: PROGRAM_INFO.name,
      overall: rep.overall, symmetry: rep.meanSymmetry, consistency: rep.meanConsistency,
      reps: rep.totalReps, target: rep.totalTarget, durationMin: rep.durationMin
    });
    while (hist.length > 60) hist.shift();
    localStorage.setItem("vimove:history", JSON.stringify(hist));
  } catch (e) {}
  renderReport(rep);
  if (reportEl) {
    reportEl.hidden = false;
    reportEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideReport() {
  if (!reportEl) return;
  reportEl.hidden = true;
  reportEl.innerHTML = "";
}

// ---------------- Drawing ----------------
function drawDots(pts, color, r = 3) {
  ctx.fillStyle = color;
  for (const lm of pts) {
    if (vis(lm) < MIN_VISIBILITY) continue;
    ctx.beginPath();
    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------- MediaPipe init ----------------
async function initModels(kindsNeeded) {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
  );
  const base = path => ({ baseOptions: { modelAssetPath: path }, runningMode: "VIDEO" });

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    ...base("https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"),
    numHands: 2, minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.6
  });
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    ...base("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"),
    numFaces: 1, outputFaceBlendshapes: false
  });
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    ...base("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"),
    numPoses: 1, minPoseDetectionConfidence: 0.6, minTrackingConfidence: 0.6
  });
}

// ---------------- Camera ----------------
async function startCam() {
  const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
  if (!window.isSecureContext && !localHost) {
    throw new Error("Camera access needs a secure context. Open the app via http://localhost:8000 or use HTTPS.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Your browser does not support camera access (getUserMedia).");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  await new Promise(r => (video.onloadedmetadata = r));
  try { await video.play(); } catch {}
}

// ---------------- Main loop ----------------
function tick() {
  if (!running) return;
  const now = performance.now();

  // FPS
  frameCount++;
  if (now - lastTime > 1000) { fpsEl.textContent = `FPS ${frameCount}`; frameCount = 0; lastTime = now; }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const ex = PLAN[ix];
  const results = {};
  const prevPhase = phase;
  let outcome = null;
  let amp = null;            // continuous amplitude (ROM) signal this frame

  try {
    if (ex.kind === "hand") {
      const r = handLandmarker.detectForVideo(video, now);
      results.hand = r;
      if (r?.landmarks?.length) {
        for (const h of r.landmarks) drawDots(h, "#22d3ee");
        // pick the hand matching the exercise side
        let value = null;
        for (let i = 0; i < r.landmarks.length; i++) {
          if (userSide(r.handedness[i]?.[0]?.categoryName || "") === ex.side) {
            value = handExtendedCount(r.landmarks[i]);
            amp = handOpenness(r.landmarks[i]);
          }
        }
        outcome = decidePhase("hand", value);
      } else { outcome = decidePhase("hand", null); }
    }
    else if (ex.kind === "mouth" || ex.kind === "blink") {
      const r = faceLandmarker.detectForVideo(video, now);
      const f = r?.faceLandmarks?.[0];
      results.face = f;
      if (f) {
        drawDots(f.filter((_, i) => i % 6 === 0), "#f9a8d4", 1.5);
        if (ex.kind === "mouth") { amp = mouthRatio(f); outcome = decidePhase("mouth", amp); }
        else { const ear = eyeEAR(f, ex.side); amp = clamp(0.30 - ear, 0, 0.30); outcome = decidePhase("blink", ear); }
      } else { outcome = decidePhase(ex.kind, null); }
    }
    else { // leg / arm / sitstand -> pose
      const r = poseLandmarker.detectForVideo(video, now);
      const p = r?.landmarks?.[0];
      results.pose = p;
      if (p) {
        drawDots(p, "#86efac");
        if (ex.kind === "leg")      { amp = legRatio(p, ex.side); outcome = decidePhase("leg", amp); }
        else if (ex.kind === "arm") { const a = armRatio(p, ex.side); amp = (a == null ? null : Math.max(0, a)); outcome = decidePhase("arm", a); }
        else                        { outcome = sitStandRep(p); amp = (standRef && lastHeight != null) ? clamp((standRef - lastHeight) / standRef, 0, 1) : null; }
      } else {
        outcome = (ex.kind === "sitstand") ? null : decidePhase(ex.kind, null);
      }
    }
  } catch (err) {
    diagEl.textContent = "Detection warning: " + (err?.message || err);
  }

  // Track peak amplitude (ROM) and start time of the current engaged phase.
  if (phase === "engaged") {
    if (prevPhase !== "engaged") { engagedStart = now; engagedPeak = (amp == null ? 0 : amp); }
    else if (amp != null) engagedPeak = Math.max(engagedPeak, amp);
  }

  if (outcome === "rep") countRep(now);
  renderLive(ex, results);

  requestAnimationFrame(tick);
}

// ---------------- Events ----------------
btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  statusEl.textContent = loc().status.starting; statusEl.className = "pill warn";
  infoEl.textContent = loc().status.requesting;
  diagEl.textContent = "";
  try {
    await startCam();
    await initModels();
    stageEl?.classList.add("is-live");
    btnStart.textContent = loc().status.running;
    ix = 0; reps = 0; resetExerciseState();
    sessionLog = PLAN.map(p => ({ ad: p.ad, kind: p.kind, side: p.side, target: p.hedef, reps: [] }));
    sessionStart = performance.now();
    hideReport();
    setExerciseUI();
    statusEl.textContent = loc().status.tracking; statusEl.className = "pill ok";
    infoEl.textContent = loc().started;
    running = true; tick();
    announceExercise();   // speak the first exercise
  } catch (e) {
    console.error(e);
    statusEl.textContent = loc().status.error; statusEl.className = "pill bad";
    infoEl.textContent = loc().status.errInfo;
    diagEl.textContent = "Details: " + (e?.message || e);
    const t = document.querySelector(".stage-empty strong");
    const s = document.querySelector(".stage-empty span");
    if (t) t.textContent = loc().status.errStage;
    if (s) s.textContent = (e?.message || String(e));
    btnStart.disabled = false;
  }
});

btnReset.addEventListener("click", () => {
  resetExercise();
  infoEl.textContent = loc().reset;
});

// Re-localize live when the language is switched mid-page
document.addEventListener("vimove:lang", () => {
  updateVoiceBtn();
  if (running) setExerciseUI();
  else renderPlan(null);
});

// Preview the full program before the camera starts
updateVoiceBtn();
renderPlan(null);
