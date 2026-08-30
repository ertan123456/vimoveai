// ViMove AI — exercise detection engine
// MediaPipe Tasks Vision (hand / face / pose) in the browser, wrapped in the
// ViMove AI LRV pipeline (see lowres.js) so it also works on the cheap, dim,
// low-resolution cameras our users actually own.
//
// Design goals (v20):
//  - Scale & distance invariant metrics (normalized by body/hand/face size)
//  - Hysteresis on every detector (separate "engage" and "release" thresholds)
//    so a held position never flickers between states
//  - One generic rep state machine (engage -> release = 1 rep)
//  - Consistent, user-perspective left/right (mirror-corrected once, used everywhere)
//  - Only the model needed for the current exercise runs each frame (higher FPS)
//  - Temporal smoothing + time-based debounce to reject noise/double counts
//  - LRV pipeline: ROI upscaling before inference, median + One Euro landmark
//    stabilisation, dropout bridging, noise-adaptive rep detection and a
//    robust range-of-motion estimator (bench/lowres_bench.mjs measures it)

import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  PoseLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8";
// NOTE: the ?v= is not decoration. Without it the browser keeps a cached
// lowres.js while game.js is refreshed by its own ?v=, the two versions
// disagree, and every frame throws. BUMP THIS whenever lowres.js changes.
import { LowResPipeline, RepDetector } from "./lowres.js?v=3";

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

canvas.width = 640; canvas.height = 480;  // fallback until the real camera frame is known

// Keep the overlay canvas's internal resolution equal to the actual camera frame.
// Landmarks are normalized (0..1) to the source frame, so a matching canvas maps
// them 1:1; object-fit:cover then crops the canvas exactly like the <video>.
function syncCanvasToVideo() {
  const w = video.videoWidth, h = video.videoHeight;
  if (w && h && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w; canvas.height = h;
  }
}

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
//
// noiseGain converts "landmark jitter in image units" into "this metric's
// units", so the LRV pipeline knows how much of the band the camera noise is
// eating (see lowres.js -> adaptHysteresis / persistFrames).
//
// rel: true  => engage/release are MULTIPLES of the user's own resting value,
// measured over the first `calibFrames` frames. Used for the postural
// movements (neck tilt, shrug, trunk bend) where the resting geometry differs
// far too much between body types for a fixed number to work.
const THRESH = {
  hand:      { engage: 3.0,  release: 1.5,  dir: +1, noiseGain: 6 },   // extended-finger count (0..4)
  mouth:     { engage: 0.45, release: 0.25, dir: +1, noiseGain: 8 },   // lip gap / mouth width
  blink:     { engage: 0.19, release: 0.28, dir: -1, noiseGain: 10 },  // eye aspect ratio (closed = low)
  leg:       { engage: 0.85, release: 0.45, dir: +1, noiseGain: 4 },   // lateral ankle offset / hip width
  arm:       { engage: 0.28, release: 0.05, dir: +1, noiseGain: 5 },   // (shoulderY - wristY) / torso
  fingertap: { engage: 0.45, release: 0.75, dir: -1, noiseGain: 8 },   // thumb-index gap / palm (tapped = small)
  neckturn:  { engage: 0.18, release: 0.08, dir: +1, noiseGain: 4 },   // |nose - shoulder mid| / shoulder width
  // Marching is FAST: the knee is only up for a handful of frames, so the
  // counter must believe a crossing immediately (maxPersist 1) or it misses reps.
  march:     { engage: 158,  release: 168,  dir: -1, noiseGain: 300, maxPersist: 1 }, // min hip-flexion angle (degrees)
  kneeext:   { engage: 150,  release: 115,  dir: +1, noiseGain: 300 }, // knee angle (straightened = large)
  elbow:     { engage: 75,   release: 150,  dir: -1, noiseGain: 300 }, // elbow angle (curled up = small)

  // ---- new in v20 -----------------------------------------------------
  // zero: true => measured as a CHANGE from the user's own neutral posture.
  // Nobody sits perfectly straight and no camera is level; without this the
  // counter ticks over while the user is sitting still.
  trunkbend: { engage: 0.19, release: 0.07, dir: +1, noiseGain: 4, zero: true },   // signed trunk lean / torso
  necktilt:  { engage: 14,   release: 5,    dir: +1, noiseGain: 250, zero: true }, // ear-line vs shoulder-line, degrees
  // A frontal camera sees a chin tuck and a shrug as a SMALL change, so these
  // bands are narrow on purpose; the LRV pipeline widens them by exactly the
  // measured camera noise instead of us guessing a safety margin.
  neckflex:  { engage: 0.88, release: 0.95, dir: -1, rel: true, calibFrames: 30, noiseGain: 4 },  // nose-to-shoulder gap, share of the user's own resting value
  shrug:     { engage: 0.88, release: 0.95, dir: -1, rel: true, calibFrames: 30, noiseGain: 4 },  // ear-to-shoulder gap, share of resting
  armabduct: { engage: 0.85, release: 0.35, dir: +1, noiseGain: 4 },   // lateral wrist offset / torso
};

// Build the active plan from the server-generated program (falls back to default).
let planSource = "server";     // "server" | "prescription" | "fallback"
let planProblem = "";

function loadPlan() {
  const el = document.getElementById("program-data");
  if (!el || !el.textContent.trim()) {
    planSource = "fallback";
    planProblem = "program verisi sayfada yok";
    return DEFAULT_PLAN;
  }
  try {
    const prog = JSON.parse(el.textContent);
    if (prog && Array.isArray(prog.exercises) && prog.exercises.length) {
      return prog.exercises.map(e => ({
        ad: e.ad, hedef: e.hedef, kind: e.kind,
        side: (e.side === undefined ? null : e.side), rationale: e.rationale || ""
      }));
    }
    planSource = "fallback";
    planProblem = "program bos geldi";
  } catch (err) {
    planSource = "fallback";
    planProblem = "program okunamadi: " + (err && err.message ? err.message : err);
    console.warn("Program data parse failed; using default plan.", err);
  }
  return DEFAULT_PLAN;
}
let PLAN = loadPlan();

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
let PROGRAM_INFO = loadProgramInfo();

// ---------------- Localization + voice ----------------
const btnVoice = document.getElementById("btnVoice");
const voiceLabelEl = document.getElementById("voiceLabel");

const LOC = {
  en: {
    side: { left: "Left", right: "Right" },
    exbase: {
      hand: "Hand Open / Close", arm: "Forward Arm Raise", armabduct: "Side Arm Raise",
      leg: "Side Leg Raise", mouth: "Mouth Open / Close", blink: "Eye Blink",
      sitstand: "Sit to Stand", fingertap: "Thumb-to-Index Tap", neckturn: "Head Turn",
      necktilt: "Head Tilt to Shoulder", neckflex: "Neck Flexion (chin to chest)", shrug: "Shoulder Shrug",
      march: "Marching in Place", kneeext: "Seated Knee Extension", elbow: "Elbow Curl",
      trunkbend: "Side Bend"
    },
    // some movements need the side inside the name, not glued to the front
    exsided: {
      necktilt: { right: "Head Tilt to Right Shoulder", left: "Head Tilt to Left Shoulder" },
      trunkbend: { right: "Side Bend to the Right", left: "Side Bend to the Left" }
    },
    instruct: {
      hand: "Open your hand wide, then make a fist.",
      arm: "Raise your arm straight in front of you above shoulder height, then lower it.",
      armabduct: "Raise your arm out to the side up to shoulder height, then lower it.",
      leg: "Take your leg out to the side, then bring it back.",
      mouth: "Open your mouth, then close it.",
      blink: "Close your eye, then open it.",
      sitstand: "Stand still to calibrate, then sit down and stand up.",
      fingertap: "Touch your thumb and index finger together, then open them wide.",
      neckturn: "Turn your head to the side, then back to the centre.",
      necktilt: "Tip your ear gently toward your shoulder, then come back upright.",
      neckflex: "Sit tall. Slowly lower your head forward and bring your chin toward your chest - only as far as is comfortable, never forced. Hold for a second, then lift your head back up.",
      shrug: "Lift both shoulders toward your ears, hold a moment, then let them drop.",
      march: "March in place — lift one knee, then the other.",
      kneeext: "While seated, straighten your knee out in front, then bend it back.",
      elbow: "Bend your elbow to bring your hand up to your shoulder, then lower it.",
      trunkbend: "Sitting or standing tall, lean your upper body to the side, then come back."
    },
    label: {
      hand: { left: "Left hand", right: "Right hand" }, mouth: "Mouth",
      blink: { left: "Left eye", right: "Right eye" },
      leg: { left: "Left leg", right: "Right leg" },
      arm: { left: "Left arm", right: "Right arm" },
      posture: "Posture", neck: "Neck", head: "Head", shoulders: "Shoulders", trunk: "Trunk",
      march: "Legs", knee: { left: "Left knee", right: "Right knee" },
      elbow: { left: "Left elbow", right: "Right elbow" }
    },
    st: {
      open: "Open", closed: "Closed", extended: "Extended", resting: "Resting",
      raised: "Raised", down: "Down", seated: "Seated", standing: "Standing",
      eyeClosed: "Closed", eyeOpen: "Open", dash: "—", tapped: "Tapped",
      turned: "Turned", center: "Centre", kneeUp: "Knee up", straight: "Straight",
      bent: "Bent", curled: "Curled", tilted: "Tilted", upright: "Upright",
      tucked: "Tucked", lifted: "Lifted", leaning: "Leaning"
    },
    calib: "Calibrating… hold still",
    nextEx: "Next exercise", done: "Well done — you finished all the exercises!", voice: "Voice",
    started: "Follow the on-screen exercise — reps are counted automatically.",
    counted: (n, t) => `counted (${n}/${t})`, reset: "Counter reset.",
    status: { starting: "Starting camera…", requesting: "Requesting camera access…", tracking: "Tracking", error: "Error", completed: "Completed", running: "Camera running", calib: "Stand upright for the first 5 seconds so we can calibrate.", errInfo: "We couldn't start the camera or load the AI models. Check camera permissions and try again.", errStage: "Couldn't start the camera" }
  },
  tr: {
    side: { left: "Sol", right: "Sağ" },
    exbase: {
      hand: "El Açma–Kapama", arm: "Kolu Öne Kaldırma", armabduct: "Kolu Yana Kaldırma",
      leg: "Bacağı Yana Açma", mouth: "Ağız Açma–Kapama", blink: "Göz Kırpma",
      sitstand: "Otur–Kalk", fingertap: "Parmak Ucu Dokunuşu", neckturn: "Başı Yana Çevirme",
      necktilt: "Başı Omza Yaklaştırma", neckflex: "Başı Öne Eğme", shrug: "Omuz Silkme",
      march: "Yerinde Yürüyüş", kneeext: "Oturarak Diz Açma", elbow: "Dirsek Bükme",
      trunkbend: "Gövdeyi Yana Eğme"
    },
    // Türkçede "Sağ Başı Omza Yaklaştırma" bozuk okunuyor — tarafı isme göm
    exsided: {
      necktilt: { right: "Başı Sağ Omza Yaklaştırma", left: "Başı Sol Omza Yaklaştırma" },
      trunkbend: { right: "Gövdeyi Sağa Eğme", left: "Gövdeyi Sola Eğme" },
      kneeext: { right: "Oturarak Sağ Dizi Açma", left: "Oturarak Sol Dizi Açma" }
    },
    instruct: {
      hand: "Elini iyice aç, sonra yumruk yap.",
      arm: "Kolunu önden omuz hizasının üstüne kaldır, sonra indir.",
      armabduct: "Kolunu yandan omuz hizasına kadar kaldır, sonra indir.",
      leg: "Bacağını yana aç, sonra geri getir.",
      mouth: "Ağzını aç, sonra kapat.",
      blink: "Gözünü kapat, sonra aç.",
      sitstand: "Önce sabit dur (kalibrasyon), sonra otur ve kalk.",
      fingertap: "Baş parmağınla işaret parmağını birbirine değdir, sonra iyice aç.",
      neckturn: "Başını yana çevir, sonra ortaya getir.",
      necktilt: "Kulağını nazikçe omzuna yaklaştır, sonra dikleş.",
      neckflex: "Dik otur, omuzların gevşek olsun. Başını yavaşça öne eğ ve çeneni göğsüne yaklaştır — sadece rahat ettiğin kadar, asla zorlama. Bir saniye öyle kal, sonra başını yavaşça geri kaldır.",
      shrug: "İki omzunu kulaklarına doğru kaldır, bir an tut, sonra bırak.",
      march: "Yerinde yürü — bir dizini kaldır, sonra diğerini.",
      kneeext: "Otururken dizini öne doğru düzelt, sonra geri bük.",
      elbow: "Dirseğini bükerek elini omzuna getir, sonra indir.",
      trunkbend: "Dik otur veya dur; gövdeni yana doğru eğ, sonra geri gel."
    },
    label: {
      hand: { left: "Sol el", right: "Sağ el" }, mouth: "Ağız",
      blink: { left: "Sol göz", right: "Sağ göz" },
      leg: { left: "Sol bacak", right: "Sağ bacak" },
      arm: { left: "Sol kol", right: "Sağ kol" },
      posture: "Duruş", neck: "Boyun", head: "Baş", shoulders: "Omuzlar", trunk: "Gövde",
      march: "Bacaklar", knee: { left: "Sol diz", right: "Sağ diz" },
      elbow: { left: "Sol dirsek", right: "Sağ dirsek" }
    },
    st: {
      open: "Açık", closed: "Kapalı", extended: "Açık", resting: "Dinlenme",
      raised: "Yukarıda", down: "Aşağıda", seated: "Oturuyor", standing: "Ayakta",
      eyeClosed: "Kapalı", eyeOpen: "Açık", dash: "—", tapped: "Değdi",
      turned: "Çevrik", center: "Ortada", kneeUp: "Yukarı", straight: "Düz",
      bent: "Bükük", curled: "Bükük", tilted: "Eğik", upright: "Dik",
      tucked: "Çekili", lifted: "Kalkık", leaning: "Eğik"
    },
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
  const g = loc();
  if (ex.side && g.exsided?.[ex.kind]?.[ex.side]) return g.exsided[ex.kind][ex.side];
  const nm = g.exbase[ex.kind] || ex.ad || ex.kind;
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
let mediaRecorder = null, recChunks = [];   // session video recording (uploaded for the specialist)
let handLandmarker, faceLandmarker, poseLandmarker;
let lastTime = performance.now(), frameCount = 0;

// rep state machine
let phase = "rest";                 // "rest" | "engaged"
let lastRepAt = 0;
let lastLandmarkAt = 0;      // when the model last returned anything

// The LRV pipeline: better pixels in, cleaner landmarks out. See lowres.js.
const pipeline = new LowResPipeline();

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
let engagedAmps = [], engagedStart = 0;   // robust ROM: median of the top samples

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
// EYE ASPECT RATIO (EAR): robust 6-point form — average of two vertical lid
// distances over the eye width. Symmetric for both eyes. side = user's side.
function eyeEAR(f, side) {
  const P = side === "right"
    ? { c1: 33,  c2: 133, u1: 160, l1: 144, u2: 158, l2: 153 }   // subject's right eye
    : { c1: 362, c2: 263, u1: 385, l1: 380, u2: 387, l2: 373 };  // subject's left eye
  const h = dist(f[P.c1], f[P.c2]) || 1e-6;
  const v = (dist(f[P.u1], f[P.l1]) + dist(f[P.u2], f[P.l2])) / 2;
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
// FINGER TAP: thumb-tip to index-tip gap, normalized by palm size (small = tapped).
function fingerTapRatio(lm) {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  return dist(lm[4], lm[8]) / palm;
}
// NECK ROTATION: horizontal nose offset from the shoulder midpoint / shoulder width.
function neckTurnRatio(p) {
  const nose = p[0], sL = p[11], sR = p[12];
  if (vis(nose) < MIN_VISIBILITY || vis(sL) < MIN_VISIBILITY || vis(sR) < MIN_VISIBILITY) return null;
  const midX = (sL.x + sR.x) / 2, sw = dist(sL, sR) || 1e-6;
  return Math.abs(nose.x - midX) / sw;
}
// MARCHING: smallest hip-flexion angle across both legs (small = a knee is lifted).
function hipFlexMin(p) {
  const R = (vis(p[12]) >= MIN_VISIBILITY && vis(p[24]) >= MIN_VISIBILITY && vis(p[26]) >= MIN_VISIBILITY) ? angle(p[12], p[24], p[26]) : 180;
  const L = (vis(p[11]) >= MIN_VISIBILITY && vis(p[23]) >= MIN_VISIBILITY && vis(p[25]) >= MIN_VISIBILITY) ? angle(p[11], p[23], p[25]) : 180;
  return (R === 180 && L === 180) ? null : Math.min(R, L);
}
// SEATED KNEE EXTENSION: knee angle hip-knee-ankle (large = straightened).
function kneeAngle(p, side) {
  const hip = side === "right" ? p[24] : p[23];
  const knee = side === "right" ? p[26] : p[25];
  const ank = side === "right" ? p[28] : p[27];
  if (vis(hip) < MIN_VISIBILITY || vis(knee) < MIN_VISIBILITY || vis(ank) < MIN_VISIBILITY) return null;
  return angle(hip, knee, ank);
}
// ELBOW CURL: elbow angle shoulder-elbow-wrist (small = curled up).
function elbowAngle(p, side) {
  const sh = side === "right" ? p[12] : p[11];
  const el = side === "right" ? p[14] : p[13];
  const wr = side === "right" ? p[16] : p[15];
  if (vis(sh) < MIN_VISIBILITY || vis(el) < MIN_VISIBILITY || vis(wr) < MIN_VISIBILITY) return null;
  return angle(sh, el, wr);
}

// TRUNK SIDE BEND: how far the shoulder line has slid sideways over the hips,
// as a share of torso length. Signed, so it can be prescribed per side —
// the concave side matters in scoliosis work.
function trunkBend(p, side) {
  const sL = p[11], sR = p[12], hL = p[23], hR = p[24];
  for (const lm of [sL, sR, hL, hR]) if (vis(lm) < MIN_VISIBILITY) return null;
  const shMid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
  const hipMid = { x: (hL.x + hR.x) / 2, y: (hL.y + hR.y) / 2 };
  const rx = hR.x - hL.x, ry = hR.y - hL.y;           // toward the subject's right
  const len = Math.hypot(rx, ry) || 1e-6;
  const torso = dist(shMid, hipMid) || 1e-6;
  const lateral = ((shMid.x - hipMid.x) * rx + (shMid.y - hipMid.y) * ry) / len / torso;
  return side === "left" ? -lateral : lateral;
}
// NECK SIDE TILT: angle between the ear line and the shoulder line, in degrees.
// Using two lines (rather than the head alone) cancels out a crooked camera.
function neckTilt(p, side) {
  const eL = p[7], eR = p[8], sL = p[11], sR = p[12];
  for (const lm of [eL, eR, sL, sR]) if (vis(lm) < MIN_VISIBILITY) return null;
  const aEar = Math.atan2(eR.y - eL.y, eR.x - eL.x);
  const aSh = Math.atan2(sR.y - sL.y, sR.x - sL.x);
  let d = (aEar - aSh) * 180 / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return side === "left" ? -d : d;                    // + = tilted to that side
}
// NECK FLEXION (looking down / chin tuck): vertical nose-to-shoulder gap,
// normalized by shoulder width. Relative mode: shrinks below the user's own
// resting value when the head drops forward.
function neckFlexRatio(p) {
  const nose = p[0], sL = p[11], sR = p[12];
  for (const lm of [nose, sL, sR]) if (vis(lm) < MIN_VISIBILITY) return null;
  const shMidY = (sL.y + sR.y) / 2, sw = dist(sL, sR) || 1e-6;
  return (shMidY - nose.y) / sw;
}
// SHOULDER SHRUG: ear-to-shoulder vertical gap over shoulder width. Shrinks
// when the shoulders lift toward the ears. Relative mode (posture varies).
function shrugRatio(p) {
  const eL = p[7], eR = p[8], sL = p[11], sR = p[12];
  for (const lm of [eL, eR, sL, sR]) if (vis(lm) < MIN_VISIBILITY) return null;
  const earY = (eL.y + eR.y) / 2, shY = (sL.y + sR.y) / 2;
  const sw = dist(sL, sR) || 1e-6;
  return (shY - earY) / sw;
}
// ARM ABDUCTION (lateral raise): how far the wrist travels sideways from the
// shoulder, as a share of torso length. Distinct from `arm`, which is forward
// flexion — shoulder rehab needs both planes.
function armAbductRatio(p, side) {
  const sh = side === "right" ? p[12] : p[11];
  const hip = side === "right" ? p[24] : p[23];
  const wr = side === "right" ? p[16] : p[15];
  for (const lm of [sh, hip, wr]) if (vis(lm) < MIN_VISIBILITY) return null;
  const torso = dist(sh, hip) || 1e-6;
  return Math.abs(wr.x - sh.x) / torso;
}

// ---------------- Generic engaged/rest decision ----------------
// The state machine itself lives in lowres.js (RepDetector) so it can be
// unit-tested and benchmarked outside the browser. One detector per exercise,
// rebuilt when the exercise changes.
let detector = null;
let detectorKind = null;

function detectorFor(kind) {
  if (!detector || detectorKind !== kind) {
    detector = new RepDetector(THRESH[kind], { cooldownMs: REP_COOLDOWN_MS });
    detectorKind = kind;
  }
  return detector;
}

/**
 * @param {string} kind exercise family
 * @param {number|null} value metric from the LOW-LAG rail (decides the rep)
 * @param {number|null} measured same metric from the SMOOTH rail (measures it)
 */
function decidePhase(kind, value, measured = null) {
  const det = detectorFor(kind);
  const out = det.update(value, performance.now(), lrvJitter(), measured);
  if (out === null) return null;
  if (out === "calibrating") return "calibrating";
  phase = det.phase;
  return out === "rep" ? "rep" : phase;
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
  } else if (ex.kind === "fingertap") {
    liveStateEl.innerHTML = chip(g.label.hand[ex.side], on, g.st.tapped, g.st.open);
  } else if (ex.kind === "neckturn") {
    liveStateEl.innerHTML = chip(g.label.neck, on, g.st.turned, g.st.center);
  } else if (ex.kind === "march") {
    liveStateEl.innerHTML = chip(g.label.march, on, g.st.kneeUp, g.st.down);
  } else if (ex.kind === "kneeext") {
    liveStateEl.innerHTML = chip(g.label.knee[ex.side], on, g.st.straight, g.st.bent);
  } else if (ex.kind === "elbow") {
    liveStateEl.innerHTML = chip(g.label.elbow[ex.side], on, g.st.curled, g.st.straight);
  } else if (ex.kind === "armabduct") {
    liveStateEl.innerHTML = chip(g.label.arm[ex.side], on, g.st.raised, g.st.down);
  } else if (ex.kind === "necktilt") {
    liveStateEl.innerHTML = chip(g.label.head, on, g.st.tilted, g.st.upright);
  } else if (ex.kind === "neckflex" || ex.kind === "shrug") {
    // these learn the user's own resting posture first
    if (detector && detector.base.rel && detector.baseline == null) {
      liveStateEl.innerHTML = `<span class="state-chip warn">${g.calib}</span>`;
    } else if (ex.kind === "neckflex") {
      liveStateEl.innerHTML = chip(g.label.head, on, g.st.tucked, g.st.upright);
    } else {
      liveStateEl.innerHTML = chip(g.label.shoulders, on, g.st.lifted, g.st.down);
    }
  } else if (ex.kind === "trunkbend") {
    liveStateEl.innerHTML = chip(g.label.trunk, on, g.st.leaning, g.st.upright);
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

// Drive the animated demo character (example movement) for the current exercise.
function updateDemo(ex) {
  const demo = document.getElementById("demoCard");
  if (!demo) return;
  demo.dataset.demoKind = ex.kind || "";
  demo.dataset.demoSide = ex.side || "";
  const cap = document.getElementById("demoCap");
  if (cap) cap.textContent = exName(ex);
}

function setExerciseUI() {
  const ex = PLAN[ix];
  exerciseNameEl.textContent = exName(ex);
  targetEl.textContent = ex.hedef;
  repsEl.textContent = reps;
  barEl.style.width = pct() + "%";
  renderPlan(ix);
  hintEl.textContent = loc().instruct[ex.kind] || "";
  updateDemo(ex);
}

function resetExerciseState() {
  phase = "rest";
  detector = null; detectorKind = null;
  pipeline.reset();                 // the ROI must re-find the body part in use
  standRef = null; calibCount = 0; heightBuf = [];
  lastRepAt = 0;
  engagedAmps = [];
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
  const top = engagedAmps.slice(0, 3);
  const peak = top.length ? top[Math.floor(top.length / 2)] : 0;   // robust peak
  if (sessionLog[ix]) sessionLog[ix].reps.push({ peak, dur });
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
  const KIND_LABEL = { hand: "Hands", arm: "Arms", armabduct: "Arms (side)", leg: "Legs",
                       blink: "Eyes", fingertap: "Fingers", kneeext: "Knees", elbow: "Elbows",
                       necktilt: "Neck", trunkbend: "Trunk" };

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

// Save one finished session to Supabase — only when signed in; silent no-op otherwise.
async function saveSessionToCloud(entry) {
  try {
    const sb = window.vimoveSupabase;
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    await sb.from("sessions").insert({ user_id: session.user.id, data: entry });
  } catch (e) { /* offline / not configured — local copy already saved */ }
}

// ---- Session video: record the camera during the session, upload for the specialist ----
function startRecording() {
  try {
    recChunks = [];
    // only record when a signed-in patient is doing the session (for their specialist)
    if (!window.vimoveUser) { mediaRecorder = null; return; }
    const stream = video.srcObject;
    if (!stream || !window.MediaRecorder) { mediaRecorder = null; return; }
    let opts = {};
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) opts = { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1200000 };
    else if (MediaRecorder.isTypeSupported("video/webm")) opts = { mimeType: "video/webm" };
    mediaRecorder = new MediaRecorder(stream, opts);
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.start(1000);
  } catch (e) { mediaRecorder = null; }
}

async function stopAndUploadVideo() {
  const rec = mediaRecorder; mediaRecorder = null;
  if (!rec || rec.state === "inactive") return null;
  const blob = await new Promise(resolve => {
    rec.onstop = () => resolve(new Blob(recChunks, { type: "video/webm" }));
    try { rec.stop(); } catch (e) { resolve(new Blob(recChunks, { type: "video/webm" })); }
  });
  recChunks = [];
  if (!blob || !blob.size) return null;
  try {
    const sb = window.vimoveSupabase;
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const path = `${session.user.id}/${Date.now()}.webm`;
    const { error } = await sb.storage.from("session-videos").upload(path, blob, { contentType: "video/webm", upsert: false });
    return error ? null : path;
  } catch (e) { return null; }
}

async function finalizeCloud(cloudEntry, rep) {
  try {
    const videoPath = await stopAndUploadVideo();
    if (videoPath) cloudEntry.video = videoPath;
  } catch (e) {}
  await saveSessionToCloud(cloudEntry);
  notifySpecialist(rep);
}

// Rule-based clinical insight ("AI note") generated from the session metrics.
function sessionNote(rep) {
  const tr = LANG() === "tr";
  const P = [];
  const comp = rep.totalTarget ? Math.round(100 * rep.totalReps / rep.totalTarget) : 0;
  if (comp >= 100) P.push(tr ? "Program eksiksiz tamamlandı." : "Completed the full program.");
  else if (comp >= 60) P.push(tr ? `Programın %${comp}'i yapıldı.` : `Completed ${comp}% of the program.`);
  else P.push(tr ? `Program kısmen yapıldı (%${comp}).` : `Only ${comp}% of the program was done.`);

  if (rep.meanConsistency >= 85) P.push(tr ? "Hareketler tutarlı ve kararlıydı." : "Movements were consistent and steady.");
  else if (rep.meanConsistency > 0) P.push(tr ? `Hareket tutarlılığı orta düzeyde (%${rep.meanConsistency}).` : `Movement consistency was moderate (${rep.meanConsistency}%).`);

  if (rep.pairs && rep.pairs.length && rep.meanSymmetry < 80)
    P.push(tr ? `Sol/sağ dengesinde belirgin fark var (%${rep.meanSymmetry} simetri).` : `Noticeable left/right asymmetry (${rep.meanSymmetry}% symmetry).`);

  const decl = (rep.exercises || []).filter(s => s.decrement != null && s.decrement >= 20);
  if (decl.length) P.push(tr
    ? `${decl.map(s => s.ad).join(", ")} hareketlerinde tekrarla küçülme (yorulma / sequence-effect) gözlendi.`
    : `Amplitude decrement (fatigue / sequence-effect) in ${decl.map(s => s.ad).join(", ")}.`);

  if (rep.overall >= 80) P.push(tr ? "Genel olarak güçlü bir seans." : "Overall a strong session.");
  else if (rep.overall < 55) P.push(tr ? "Yakın takip önerilir." : "Closer follow-up suggested.");
  return P.join(" ");
}

// When a patient finishes, message their specialist with the summary + AI note.
async function notifySpecialist(rep) {
  try {
    const sb = window.vimoveSupabase;
    if (!sb) return;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data: prof } = await sb.from("profiles").select("specialist_id,full_name").eq("id", session.user.id).single();
    if (!prof || !prof.specialist_id) return;
    const tr = LANG() === "tr";
    const name = prof.full_name || (tr ? "Hasta" : "Patient");
    const sym = (rep.pairs && rep.pairs.length) ? `, ${tr ? "simetri" : "symmetry"} %${rep.meanSymmetry}` : "";
    const head = tr
      ? `📋 ${name} bir seansı tamamladı — ${rep.totalReps}/${rep.totalTarget} tekrar, %${rep.meanConsistency} tutarlılık${sym}, skor ${rep.overall}/100 (${rep.durationMin} dk).`
      : `📋 ${name} finished a session — ${rep.totalReps}/${rep.totalTarget} reps, ${rep.meanConsistency}% consistency${sym}, score ${rep.overall}/100 (${rep.durationMin} min).`;
    const body = head + "\n🤖 " + sessionNote(rep);
    await sb.from("messages").insert({ sender_id: session.user.id, recipient_id: prof.specialist_id, body: body });
  } catch (e) { /* best-effort */ }
}

function showReport() {
  const rep = computeReport();
  try { localStorage.setItem("vimove:lastReport", JSON.stringify(rep)); } catch (e) {}
  // Append a compact entry to the progress history (for the /progress dashboard)
  const entry = {
    when: rep.when, disease: PROGRAM_INFO.disease, name: PROGRAM_INFO.name,
    overall: rep.overall, symmetry: rep.meanSymmetry, consistency: rep.meanConsistency,
    reps: rep.totalReps, target: rep.totalTarget, durationMin: rep.durationMin
  };
  try {
    const hist = JSON.parse(localStorage.getItem("vimove:history") || "[]");
    hist.push(entry);
    while (hist.length > 60) hist.shift();
    localStorage.setItem("vimove:history", JSON.stringify(hist));
  } catch (e) {}
  // Cloud copy for the specialist gets the full per-exercise data + the AI note.
  const cloudEntry = Object.assign({}, entry, {
    exercises: (rep.exercises || []).map(s => ({
      ad: s.ad, kind: s.kind, reps: s.reps, target: s.target,
      consistency: s.consistency, tempo: s.tempo, decrement: s.decrement
    })),
    note: sessionNote(rep)
  });
  // Finalize the cloud copy in the background: stop + upload the session video,
  // then save the session (with the video path) and notify the specialist.
  finalizeCloud(cloudEntry, rep);
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

// ---------------- Camera quality badge ----------------
// Tells the user what the LRV pipeline is doing about their camera, in words
// they can act on ("the room is dark") rather than numbers.
let lastBadgeAt = 0;
function updateCameraBadge(now) {
  const el = document.getElementById("camQuality");
  if (!el) return;
  now = now || performance.now();
  if (now - lastBadgeAt < 700) return;
  lastBadgeAt = now;
  const st = pipeline.status();
  const tr = LANG() === "tr";
  const res = (video.videoWidth && video.videoHeight) ? `${video.videoWidth}x${video.videoHeight}` : "—";
  const noBody = running && lastLandmarkAt && (now - lastLandmarkAt > 1500);
  let text, cls;

  if (planSource === "fallback") {
    cls = "warn";
    text = tr ? "Program yüklenemedi — yedek liste kullanılıyor" : "Program failed to load — using the fallback list";
  } else if (noBody) {
    cls = "warn";
    text = tr ? "Vücudun görünmüyor — kadraja gir, ışığı artır" : "You are not visible — step into frame, add light";
  } else if (!lrvOk) {
    cls = "warn";
    text = tr ? "Kamera iyileştirmesi kapalı · " + res : "Camera enhancement off · " + res;
  } else if (st.quality < 0.45) {
    cls = "warn";
    text = tr ? "Ortam karanlık — ışığı artır" : "Too dark — add more light";
  } else if (st.lowRes || st.magnification > 1.2) {
    cls = "ok";
    text = tr
      ? `Düşük çözünürlük telafisi açık · ${res} · ${st.magnification.toFixed(1)}x`
      : `Low-resolution boost on · ${res} · ${st.magnification.toFixed(1)}x`;
  } else {
    cls = "ok";
    text = tr ? `Kamera iyi · ${res}` : `Camera good · ${res}`;
  }
  el.className = "cam-chip " + cls;
  el.textContent = text;
  el.hidden = false;

  // one compact technical line, only when something is actually wrong
  if (diagEl && (planSource === "fallback" || !lrvOk || noBody)) {
    const bits = [];
    if (planSource === "fallback") bits.push("plan: yedek (" + planProblem + ")");
    if (!lrvOk) bits.push("LRV: kapali (" + lrvError + ")");
    if (noBody) bits.push("model " + Math.round((now - lastLandmarkAt) / 1000) + " sn'dir nokta dondurmuyor");
    diagEl.textContent = bits.join(" · ");
  }
}

// ---------------- MediaPipe init ----------------
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
  );
  const base = path => ({ baseOptions: { modelAssetPath: path }, runningMode: "VIDEO" });

  // One retry per model: a single failed download used to leave a landmarker
  // undefined, and every frame of that exercise then threw silently.
  const withRetry = async (name, make) => {
    try { return await make(); }
    catch (e) {
      console.warn("model retry:", name, e);
      return await make();
    }
  };

  handLandmarker = await withRetry("hand", () => HandLandmarker.createFromOptions(vision, {
    ...base("https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"),
    numHands: 2, minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.6
  }));
  faceLandmarker = await withRetry("face", () => FaceLandmarker.createFromOptions(vision, {
    ...base("https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"),
    numFaces: 1, outputFaceBlendshapes: false
  }));
  poseLandmarker = await withRetry("pose", () => PoseLandmarker.createFromOptions(vision, {
    ...base("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"),
    numPoses: 1, minPoseDetectionConfidence: 0.6, minTrackingConfidence: 0.6
  }));
  if (!handLandmarker || !faceLandmarker || !poseLandmarker) {
    throw new Error("AI modelleri yuklenemedi");
  }
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
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } }
  });
  video.srcObject = stream;
  await new Promise(r => (video.onloadedmetadata = r));
  // Match the overlay canvas to the REAL camera frame so landmark coordinates
  // (normalized to the source frame) map 1:1 — and object-fit:cover then crops
  // the canvas exactly like the <video>, keeping the dots glued to the body.
  syncCanvasToVideo();
  // The LRV pipeline needs to know what it is really working with: many
  // laptops silently hand back 640x480 no matter what we asked for.
  pipeline.setFrameSize(video.videoWidth, video.videoHeight);
  updateCameraBadge();
  try { await video.play(); } catch {}
}

// ---------------- Pipeline safety ----------------
// The LRV pipeline is an ENHANCEMENT. If anything in it ever throws on a
// particular device or browser, the exercise itself must keep working: we
// disable the pipeline for the rest of the session, fall back to the raw
// landmarks, and say so on screen instead of silently freezing.
let lrvOk = true;
let lrvError = "";
function lrvFail(where, e) {
  lrvOk = false;
  pipeline.enabled = false;
  lrvError = where + ": " + (e && e.message ? e.message : e);
  if (diagEl) diagEl.textContent = "LRV devre disi (" + lrvError + ") — egzersiz ham veriyle devam ediyor.";
  console.warn("LRV disabled -", lrvError);
}
function lrvPrepare(v) {
  if (!lrvOk) return v;
  try { return pipeline.prepare(v); } catch (e) { lrvFail("prepare", e); return v; }
}
function lrvStabilize(lms, t) {
  if (!lrvOk) return lms;
  try { return pipeline.stabilize(lms, t); } catch (e) { lrvFail("stabilize", e); return lms; }
}
function lrvToFrame(lms) {
  if (!lrvOk) return lms;
  try { return pipeline.toFrame(lms); } catch (e) { lrvFail("toFrame", e); return lms; }
}
function lrvJitter() { return lrvOk ? pipeline.jitter : 0; }

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

  // The LRV pipeline decides what the model actually looks at this frame:
  // the raw video, or a cropped-and-upscaled window around the body part in
  // use (which is what rescues a low-resolution camera).
  const input = lrvPrepare(video);

  try {
    if (ex.kind === "hand" || ex.kind === "fingertap") {
      const r = handLandmarker.detectForVideo(input, now);
      results.hand = r;
      let raw = null;
      if (r?.landmarks?.length) {
        for (let i = 0; i < r.landmarks.length; i++) {
          if (userSide(r.handedness[i]?.[0]?.categoryName || "") === ex.side) raw = r.landmarks[i];
        }
      }
      if (raw) lastLandmarkAt = now;
      const lm = lrvStabilize(raw, now);          // smooth rail (measuring)
      const fast = pipeline.fast || lm;                 // low-lag rail (counting)
      if (raw || lm) drawDots(lrvToFrame(raw) || lm, "#22d3ee");
      if (lm && fast) {
        if (ex.kind === "fingertap") {
          const v = fingerTapRatio(fast), m = fingerTapRatio(lm);
          amp = clamp(0.9 - m, 0, 0.9);
          outcome = decidePhase("fingertap", v, m);
        } else {
          const v = handExtendedCount(fast);
          amp = handOpenness(lm);
          outcome = decidePhase("hand", v, handExtendedCount(lm));
        }
      } else { outcome = decidePhase(ex.kind, null); }
    }
    else if (ex.kind === "mouth" || ex.kind === "blink") {
      const r = faceLandmarker.detectForVideo(input, now);
      const raw = r?.faceLandmarks?.[0] || null;
      if (raw) lastLandmarkAt = now;
      const f = lrvStabilize(raw, now);
      const fast = pipeline.fast || f;
      results.face = f;
      if (f && fast) {
        drawDots((lrvToFrame(raw) || f).filter((_, i) => i % 6 === 0), "#f9a8d4", 1.5);
        if (ex.kind === "mouth") {
          const m = mouthRatio(f);
          amp = m;
          outcome = decidePhase("mouth", mouthRatio(fast), m);
        } else {
          const ear = eyeEAR(f, ex.side);
          amp = clamp(0.30 - ear, 0, 0.30);
          outcome = decidePhase("blink", eyeEAR(fast, ex.side), ear);
        }
      } else { outcome = decidePhase(ex.kind, null); }
    }
    else { // every pose-based movement
      const r = poseLandmarker.detectForVideo(input, now);
      if (r?.landmarks?.[0]) lastLandmarkAt = now;
      const p = lrvStabilize(r?.landmarks?.[0] || null, now);
      const fast = pipeline.fast || p;
      results.pose = p;
      if (p && fast) {
        drawDots(lrvToFrame(r?.landmarks?.[0]) || p, "#86efac");
        const side = ex.side;
        // value = fast rail (decides the rep), measured = smooth rail (sizes it)
        const both = fn => [fn(fast, side), fn(p, side)];
        if (ex.kind === "leg") {
          const [v, m] = both(legRatio); amp = m; outcome = decidePhase("leg", v, m);
        } else if (ex.kind === "arm") {
          const [v, m] = both(armRatio); amp = (m == null ? null : Math.max(0, m));
          outcome = decidePhase("arm", v, m);
        } else if (ex.kind === "armabduct") {
          const [v, m] = both(armAbductRatio); amp = (m == null ? null : clamp(m / 1.4, 0, 1));
          outcome = decidePhase("armabduct", v, m);
        } else if (ex.kind === "neckturn") {
          const [v, m] = both(p2 => neckTurnRatio(p2)); amp = m;
          outcome = decidePhase("neckturn", v, m);
        } else if (ex.kind === "necktilt") {
          const [v, m] = both(neckTilt); amp = (m == null ? null : clamp(m / 40, 0, 1));
          outcome = decidePhase("necktilt", v, m);
        } else if (ex.kind === "trunkbend") {
          const [v, m] = both(trunkBend); amp = (m == null ? null : clamp(m / 0.35, 0, 1));
          outcome = decidePhase("trunkbend", v, m);
        } else if (ex.kind === "neckflex" || ex.kind === "shrug") {
          const fn = ex.kind === "neckflex" ? neckFlexRatio : shrugRatio;
          const v = fn(fast), m = fn(p);
          outcome = decidePhase(ex.kind, v, m);
          const bl = detector?.baseline;                 // learned resting value
          amp = (m == null || !bl) ? null : clamp(1 - m / bl, 0, 1);
        } else if (ex.kind === "march") {
          const [v, m] = both(p2 => hipFlexMin(p2)); amp = (m == null ? null : clamp((160 - m) / 160, 0, 1));
          outcome = decidePhase("march", v, m);
        } else if (ex.kind === "kneeext") {
          const [v, m] = both(kneeAngle); amp = (m == null ? null : clamp((m - 90) / 90, 0, 1));
          outcome = decidePhase("kneeext", v, m);
        } else if (ex.kind === "elbow") {
          const [v, m] = both(elbowAngle); amp = (m == null ? null : clamp((160 - m) / 160, 0, 1));
          outcome = decidePhase("elbow", v, m);
        } else {
          outcome = sitStandRep(p);
          amp = (standRef && lastHeight != null) ? clamp((standRef - lastHeight) / standRef, 0, 1) : null;
        }
      } else {
        outcome = (ex.kind === "sitstand") ? null : decidePhase(ex.kind, null);
      }
    }
  } catch (err) {
    diagEl.textContent = "Detection warning: " + (err?.message || err);
  }

  // Track range of motion for the current engaged phase. We keep the best few
  // samples instead of a single maximum: on a noisy camera the maximum is
  // whatever the worst frame did, which would inflate every report.
  if (phase === "engaged") {
    if (prevPhase !== "engaged") { engagedStart = now; engagedAmps = []; }
    if (amp != null) {
      engagedAmps.push(amp);
      engagedAmps.sort((a, b) => b - a);
      if (engagedAmps.length > 5) engagedAmps.length = 5;
    }
  }

  try {
    if (outcome === "rep") countRep(now);
    renderLive(ex, results);
    updateCameraBadge(now);
  } catch (err) {
    console.warn("frame render error", err);
  }

  requestAnimationFrame(tick);   // the loop always survives the frame
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
    startRecording();     // record the session for the specialist
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

// If the signed-in patient has an active prescription from their specialist,
// use it as the program (overrides the condition-based default).
async function loadPrescription() {
  const sb = window.vimoveSupabase || await new Promise(res => {
    let done = false;
    const on = () => { if (done) return; done = true; res(window.vimoveSupabase); };
    window.addEventListener("vimove:supabase-ready", on, { once: true });
    setTimeout(() => { if (!done) { done = true; res(window.vimoveSupabase || null); } }, 4000);
  });
  if (!sb) return;
  let session;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) { return; }
  if (!session) return;
  try {
    const { data } = await sb.from("prescriptions")
      .select("title,program,note")
      .eq("patient_id", session.user.id).eq("active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!data || !Array.isArray(data.program) || !data.program.length) return;
    PLAN = data.program.map(e => ({
      ad: e.ad, hedef: e.hedef || 8, kind: e.kind,
      side: (e.side === undefined ? null : e.side), rationale: ""
    }));
    PROGRAM_INFO = { disease: "recete", name: data.title || "Reçete" };
    ix = 0;
    if (running) setExerciseUI(); else renderPlan(null);
    if (infoEl) infoEl.textContent = LANG() === "tr"
      ? "Uzmanının reçetesi yüklendi." : "Your specialist's prescription is loaded.";
  } catch (e) { /* fall back to the default program */ }
}
loadPrescription();

// ---------------- QA hook ----------------
// Exposes the pure metric functions and the pipeline so the detectors can be
// driven with synthetic landmarks (no camera) from the console or a test page.
window.vimoveEngine = {
  THRESH, pipeline,
  metrics: { trunkBend, neckTilt, neckFlexRatio, shrugRatio, armAbductRatio,
             legRatio, armRatio, kneeAngle, elbowAngle, hipFlexMin, neckTurnRatio,
             handOpenness, fingerTapRatio, mouthRatio, eyeEAR },
  decidePhase, resetExerciseState,
  get detector() { return detector; }
};
