// =====================================================================
// ViMove AI — LRV (Low-Resolution Vision) pipeline
// ---------------------------------------------------------------------
// Why this exists
// ---------------
// Our users are mostly older adults at home. They do not have a 1080p
// webcam: they have a 5-year-old laptop with a 480p (or worse) camera, in
// a dim living room, sitting 2-3 metres away. On that input the raw
// MediaPipe landmark stream has three problems:
//
//   1. The person is SMALL in the frame, so the landmark model only gets a
//      handful of pixels to work with and coordinates become coarse.
//   2. Landmarks JITTER frame to frame (pixel quantisation + sensor noise),
//      which makes a rep counter fire twice for one movement.
//   3. Landmarks DROP OUT for a few frames (motion blur, low light), which
//      breaks a state machine mid-repetition.
//
// The LRV pipeline is four stages layered on top of MediaPipe Tasks —
// it does not replace the model, it feeds it better pixels and cleans up
// what comes back:
//
//   [1] AdaptiveROI      crop to the subject + upscale before inference
//                        (raises the effective pixel density on the body)
//   [2] LandmarkStabilizer  One Euro adaptive filter per landmark
//                        (Casiez, Roussel & Vogel, CHI 2012) + constant
//                        velocity gap filling for short dropouts
//   [3] NoiseEstimator   measures the residual jitter of the stream and
//                        widens the rep-counter hysteresis band by exactly
//                        that much -> phantom reps disappear on noisy input
//   [4] FrameQuality     brightness / contrast / sharpness of the frame, so
//                        the UI can tell the user "your room is too dark"
//
// Two rails, on purpose
// ---------------------
// Counting a repetition and measuring it want opposite things. Counting wants
// a fast signal (a smoothed one crosses the threshold late, or not at all, and
// the rep is lost). Measuring range of motion wants a smooth signal (noise
// inflates the peak, and the clinical score with it). So the pipeline exposes
// BOTH: a low-lag median-only rail that drives the state machine, and a fully
// filtered rail that feeds the report — plus a robust (median-of-top-k) peak
// estimator instead of a plain maximum.
//
// Everything runs in the browser, on the device. No frame is uploaded for
// this. The module is dependency-free and DOM-optional so it can be unit
// tested in Node (see bench/lowres_bench.mjs).
// =====================================================================

// ---------------------------------------------------------------------
// [2a] One Euro filter — adaptive low-pass.
// Slow movement  -> heavy smoothing (kills jitter)
// Fast movement  -> light smoothing (kills lag)
// Reference: Casiez G., Roussel N., Vogel D. "1 Euro Filter: A Simple
// Speed-based Low-pass Filter for Noisy Input in Interactive Systems",
// CHI 2012.
// ---------------------------------------------------------------------
class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) {
    this.y = (this.y === null) ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  get value() { return this.y; }
}

export class OneEuroFilter {
  /**
   * @param {number} minCutoff  base cutoff in Hz. Lower = smoother at rest.
   * @param {number} beta       speed coefficient. Higher = less lag when fast.
   * @param {number} dCutoff    cutoff for the derivative estimate.
   */
  constructor(minCutoff = 2.0, beta = 0.06, dCutoff = 1.0, maxCutoff = 6.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.maxCutoff = maxCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.tPrev = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  /** @param {number} x value @param {number} t timestamp in SECONDS */
  filter(x, t) {
    if (this.tPrev === null) { this.tPrev = t; this.x.filter(x, 1); return x; }
    const dt = Math.max(1e-3, t - this.tPrev);
    this.tPrev = t;
    const dxRaw = (x - this.x.value) / dt;
    const edx = this.dx.filter(dxRaw, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = Math.min(this.maxCutoff, this.minCutoff + this.beta * Math.abs(edx));
    return this.x.filter(x, OneEuroFilter.alpha(cutoff, dt));
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = null; }
}

// ---------------------------------------------------------------------
// [3] Noise estimator — how jittery is this camera, right now?
// We high-pass the landmark stream (value minus its own smoothed value)
// and track the median absolute deviation of that residual. MAD is used
// instead of the standard deviation because a real movement should not be
// allowed to inflate the "noise" estimate.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// [2a-bis] Median prefilter.
// A One Euro filter is excellent against small continuous jitter and useless
// against a GROSS error — a wrist landmark that jumps 10 px onto the
// background for one frame. A 3-tap running median removes exactly those
// single-frame outliers and costs almost nothing, so it runs first.
// ---------------------------------------------------------------------
export class MedianPrefilter {
  constructor(window = 3) { this.window = window; this.buf = []; }
  push(x) {
    this.buf.push(x);
    if (this.buf.length > this.window) this.buf.shift();
    const s = [...this.buf].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
  reset() { this.buf = []; }
}

export class NoiseEstimator {
  constructor(window = 90) { this.window = window; this.buf = []; this.mad = 0; }
  push(residual) {
    this.buf.push(Math.abs(residual));
    if (this.buf.length > this.window) this.buf.shift();
    if (this.buf.length >= 12) {
      const s = [...this.buf].sort((a, b) => a - b);
      this.mad = s[Math.floor(s.length / 2)];
    }
  }
  /** Normalised jitter in image units (0 = perfectly stable). */
  get level() { return this.mad; }
  reset() { this.buf = []; this.mad = 0; }
}

// ---------------------------------------------------------------------
// [2b] Landmark stabiliser — One Euro per coordinate + gap filling.
// ---------------------------------------------------------------------
export class LandmarkStabilizer {
  /**
   * @param {object} opts
   *   minCutoff / beta : One Euro tuning
   *   maxGapFrames     : how many missing frames we bridge by extrapolation
   *   minVisibility    : landmarks below this are treated as missing
   */
  constructor(opts = {}) {
    this.minCutoff = opts.minCutoff ?? 2.0;
    this.beta = opts.beta ?? 0.06;
    this.maxGapFrames = opts.maxGapFrames ?? 6;
    this.medianWindow = opts.medianWindow ?? 5;
    this.minVisibility = opts.minVisibility ?? 0.3;
    this.filters = new Map();       // index -> {fx, fy}
    this.last = new Map();          // index -> {x, y, vx, vy, t}
    this.gap = 0;
    this.noise = new NoiseEstimator();
    this.bridgedFrames = 0;         // diagnostics: how often we filled a gap
    this.frames = 0;
    this.fast = null;               // "fast rail" landmarks (median only)
  }

  _f(i) {
    let f = this.filters.get(i);
    if (!f) {
      f = { fx: new OneEuroFilter(this.minCutoff, this.beta),
            fy: new OneEuroFilter(this.minCutoff, this.beta),
            mx: new MedianPrefilter(this.medianWindow),
            my: new MedianPrefilter(this.medianWindow) };
      this.filters.set(i, f);
    }
    return f;
  }

  /**
   * @param {Array|null} landmarks raw MediaPipe landmarks ({x,y,z,visibility})
   * @param {number} tMs timestamp in milliseconds
   * @returns {Array|null} stabilised landmarks, or null if nothing usable
   */
  process(landmarks, tMs) {
    const t = tMs / 1000;

    // --- dropout: extrapolate from the last known position + velocity ---
    if (!landmarks || !landmarks.length) {
      this.gap++;
      if (this.gap > this.maxGapFrames || this.last.size === 0) return null;
      this.bridgedFrames++;
      const out = [];
      for (const [i, p] of this.last) {
        const dt = Math.min(0.2, t - p.t);
        out[i] = { x: p.x + p.vx * dt, y: p.y + p.vy * dt, z: p.z ?? 0,
                   visibility: Math.max(0, (p.visibility ?? 1) - 0.15 * this.gap),
                   predicted: true };
      }
      this.fast = out;
      return out;
    }

    this.gap = 0;
    this.frames++;
    const out = new Array(landmarks.length);
    const med = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const v = lm.visibility === undefined ? 1 : lm.visibility;
      const prev = this.last.get(i);

      if (v < this.minVisibility && prev) {
        // Low-confidence point: keep the previous filtered value rather than
        // letting a garbage coordinate enter the metric.
        out[i] = { x: prev.x, y: prev.y, z: prev.z ?? 0, visibility: v, held: true };
        med[i] = out[i];
        continue;
      }

      const f = this._f(i);
      // median first (kills single-frame gross errors), then One Euro
      const mx = f.mx.push(lm.x), my = f.my.push(lm.y);
      const fx = f.fx.filter(mx, t);
      const fy = f.fy.filter(my, t);
      // "fast rail": median only — nearly zero lag, already outlier-free.
      med[i] = { x: mx, y: my, z: lm.z ?? 0, visibility: v };

      // residual after the median = the continuous noise we still carry
      this.noise.push(Math.hypot(mx - fx, my - fy));

      const dt = prev ? Math.max(1e-3, t - prev.t) : 1;
      out[i] = { x: fx, y: fy, z: lm.z ?? 0, visibility: v };
      this.last.set(i, {
        x: fx, y: fy, z: lm.z ?? 0, visibility: v, t,
        vx: prev ? (fx - prev.x) / dt : 0,
        vy: prev ? (fy - prev.y) / dt : 0,
      });
    }
    this.fast = med;
    return out;
  }

  get jitter() { return this.noise.level; }

  reset() {
    this.filters.clear(); this.last.clear();
    this.gap = 0; this.noise.reset();
    this.bridgedFrames = 0; this.frames = 0;
  }
}

// ---------------------------------------------------------------------
// [3b] Noise-adaptive hysteresis.
// A rep is counted when a metric crosses `engage` and comes back past
// `release`. If the camera noise is bigger than the gap between those two
// numbers, the metric will cross them on its own and count reps that never
// happened. So: push the two thresholds apart by the measured noise.
// ---------------------------------------------------------------------
/**
 * @param {{engage:number, release:number, dir:number, noiseGain?:number}} base
 * @param {number} jitter   normalised landmark jitter from the stabiliser
 * @param {number} [cap]    maximum widening as a fraction of the base band.
 *                        Kept small on purpose: a threshold that noise pushes
 *                        outside the signal range would stall the counter.
 * @returns {{engage:number, release:number, dir:number, widened:number}}
 */
export const NOISE_FLOOR = 0.25;   // noise below 25% of the band is free

export function adaptHysteresis(base, jitter, cap = 0.15) {
  const band = Math.abs(base.engage - base.release);
  // noiseGain converts "landmark jitter in image units" into "metric units"
  // for this particular metric (a ratio, an angle in degrees, a count...).
  const gain = base.noiseGain ?? 1;
  // Hysteresis alone already absorbs noise up to a quarter of the band, and
  // widening for nothing only costs us real repetitions. So we widen by the
  // EXCESS noise beyond that, never by the raw noise.
  const excess = Math.max(0, jitter * gain - NOISE_FLOOR * band);
  const widen = Math.min(band * cap, excess);
  const d = base.dir > 0 ? widen : -widen;
  return {
    engage: base.engage + d,
    release: base.release - d,
    dir: base.dir,
    widened: widen,
  };
}

// ---------------------------------------------------------------------
// [3c] RepDetector — the state machine that turns a metric into repetitions.
//
// Three things make it survive a bad camera:
//
//   * hysteresis          separate engage / release thresholds (as before)
//   * noise-adaptive
//     persistence         a threshold crossing must SURVIVE k frames before it
//                         is believed, and k grows with the measured jitter.
//                         Unlike widening the thresholds, this can never make
//                         a threshold unreachable, so the counter cannot stall.
//   * relative baseline   some metrics (neck tilt, shrug, trunk bend) differ a
//                         lot between body types. In `rel` mode the first
//                         `calibFrames` frames measure the user's own resting
//                         value and the thresholds are applied as MULTIPLES of
//                         it, so no per-user tuning is needed.
// ---------------------------------------------------------------------
export class RepDetector {
  /**
   * @param {object} base {engage, release, dir, noiseGain?, rel?, calibFrames?}
   * @param {object} opts {cooldownMs?, smoothing?, maxPersist?}
   */
  constructor(base, opts = {}) {
    this.base = base;
    this.cooldownMs = opts.cooldownMs ?? 350;
    this.smoothing = opts.smoothing ?? 3;      // small mean, the One Euro does the real work
    this.maxPersist = opts.maxPersist ?? 4;
    this.reset();
  }

  reset() {
    this.phase = "rest";
    this.buf = [];
    this.lastRepAt = -1e9;
    this.candidate = null;
    this.candidateFrames = 0;
    this.peakBuf = [];
    this.lastPeak = 0;
    this.calib = [];
    this.range = [];
    this.baseline = null;
    this.lastThresholds = null;
  }

  /** How many consecutive frames a crossing must hold, given the noise. */
  persistFrames(jitter) {
    const band = Math.abs(this.base.engage - this.base.release) || 1;
    const gain = this.base.noiseGain ?? 1;
    const ratio = (jitter * gain) / band;               // noise as a share of the band
    // Same idea as the widening: quiet streams pay no penalty at all.
    const excess = Math.max(0, ratio - NOISE_FLOOR);
    return 1 + Math.min(this.maxPersist - 1, Math.round(excess * 6));
  }

  /**
   * @param {number|null} value raw metric this frame (null = no reading)
   * @param {number} tMs timestamp
   * @param {number} jitter landmark jitter from the stabiliser (0 if unknown)
   * @param {number|null} measured optional smooth-rail value used for the
   *        range-of-motion peak (defaults to `value`)
   * @returns {"rest"|"engaged"|"rep"|"calibrating"|null}
   */
  update(value, tMs, jitter = 0, measured = null) {
    if (value == null || Number.isNaN(value)) return null;

    this.buf.push(value);
    if (this.buf.length > this.smoothing) this.buf.shift();
    const v = this.buf.reduce((a, b) => a + b, 0) / this.buf.length;

    // relative mode: learn this user's resting value, and keep learning it.
    // A one-shot calibration would (a) waste the first repetition and (b) go
    // stale as soon as the user shifts in their chair, so the baseline is a
    // rolling percentile over the last few seconds instead.
    let engage = this.base.engage, release = this.base.release;
    if (this.base.rel) {
      this.calib.push(v);
      if (this.calib.length > 150) this.calib.shift();       // ~5 s at 30 fps
      // 12 frames (~0.4 s) is enough for a first estimate; the rolling window
      // keeps correcting it, so we arm the counter early instead of eating the
      // user's first repetition.
      const need = Math.min(12, this.base.calibFrames ?? 12);
      if (this.calib.length < need) return "calibrating";
      if (this.baseline == null || this.calib.length % 15 === 0) {
        // The resting value is not the MIDDLE of what we saw: for a metric that
        // shrinks during the movement (dir < 0) rest is the high end, and vice
        // versa. Taking a percentile from the correct end means a user who
        // starts moving during calibration still gets a sane baseline.
        const srt = [...this.calib].sort((a, b) => a - b);
        const q = this.base.dir > 0 ? 0.2 : 0.8;
        this.baseline = srt[Math.min(srt.length - 1, Math.floor(srt.length * q))] || 1e-6;
      }
      engage = this.baseline * this.base.engage;
      release = this.baseline * this.base.release;
    }

    // Track the range this metric actually reaches, so noise-widening can
    // never push a threshold outside the signal (that would stall the
    // counter: the user moves, but the bar can no longer be crossed).
    this.range.push(v);
    if (this.range.length > 120) this.range.shift();
    const lo = Math.min(...this.range), hi = Math.max(...this.range);
    const span = hi - lo;

    let th = adaptHysteresis({ ...this.base, engage, release }, jitter);
    if (span > 1e-6) {
      const guard = 0.08 * span;
      if (th.dir > 0) {
        th.engage = Math.min(th.engage, hi - guard);
        th.release = Math.max(th.release, lo + guard);
      } else {
        th.engage = Math.max(th.engage, lo + guard);
        th.release = Math.min(th.release, hi - guard);
      }
      // never let the widening invert or collapse the band
      if ((th.dir > 0 && th.engage <= th.release) || (th.dir < 0 && th.engage >= th.release)) {
        th = { engage, release, dir: this.base.dir, widened: 0 };
      }
    }
    this.lastThresholds = th;
    const need = this.persistFrames(jitter);

    // Robust peak (range of motion) for the clinical report. The plain maximum
    // of a noisy signal is biased UPWARDS — one bad frame becomes "the user's
    // range of motion". We keep the best few samples of the engaged phase and
    // take their median instead.
    if (this.phase === "engaged") {
      // On a clean stream the smooth rail only adds lag, which shrinks the
      // measured peak. So we only switch to it once the camera is actually
      // noisy — the filtering strength follows the measured conditions.
      const band = Math.abs(this.base.engage - this.base.release) || 1;
      // measurement is more noise-sensitive than counting, so it switches to
      // the filtered rail earlier (at 40% of the counting noise floor)
      const noisy = jitter * (this.base.noiseGain ?? 1) > 0.4 * NOISE_FLOOR * band;
      const pv = (!noisy || measured == null || Number.isNaN(measured)) ? v : measured;
      this.peakBuf.push(th.dir > 0 ? pv : -pv);
      this.peakBuf.sort((a, b) => b - a);
      if (this.peakBuf.length > 5) this.peakBuf.length = 5;
    }

    const isEngaged = th.dir > 0 ? v >= th.engage : v <= th.engage;
    const isRested  = th.dir > 0 ? v <= th.release : v >= th.release;
    const want = (this.phase === "rest" && isEngaged) ? "engaged"
               : (this.phase === "engaged" && isRested) ? "rest" : null;

    if (!want) { this.candidate = null; this.candidateFrames = 0; return this.phase; }

    if (this.candidate === want) this.candidateFrames++;
    else { this.candidate = want; this.candidateFrames = 1; }
    if (this.candidateFrames < need) return this.phase;   // not convinced yet

    this.candidate = null; this.candidateFrames = 0;
    if (want === "engaged") { this.phase = "engaged"; this.peakBuf = []; return "engaged"; }

    // closing an engaged phase: freeze its robust peak
    if (this.peakBuf.length) {
      const top = this.peakBuf.slice(0, 3);
      const m = top[Math.floor(top.length / 2)];
      this.lastPeak = this.base.dir > 0 ? m : -m;
    }
    this.peakBuf = [];
    this.phase = "rest";
    if (tMs - this.lastRepAt < this.cooldownMs) return "rest";   // debounce
    this.lastRepAt = tMs;
    return "rep";
  }
}

// ---------------------------------------------------------------------
// [1] Adaptive ROI — crop to the subject, then upscale before inference.
// On a 480p camera a seated person occupies maybe 180x220 px. Cropping to
// that box and re-rendering it at 512 px means the landmark model receives
// roughly 2.5x the pixel density on the part of the image that matters.
// Needs a DOM canvas, so it is disabled automatically in Node.
// ---------------------------------------------------------------------
export class AdaptiveROI {
  /**
   * @param {object} opts
   *   target      : output square size fed to the detector (px)
   *   margin      : extra room around the subject box (fraction)
   *   smoothing   : 0..1 box smoothing across frames (higher = calmer box)
   *   minUpscale  : only crop when it buys at least this much magnification
   */
  constructor(opts = {}) {
    this.target = opts.target ?? 512;
    this.margin = opts.margin ?? 0.18;
    this.smoothing = opts.smoothing ?? 0.82;
    this.minUpscale = opts.minUpscale ?? 1.25;
    this.box = null;                 // {x, y, w, h} normalised to the frame
    this.rect = null;                // last crop actually used, in pixels
    this.scale = 1;                  // achieved magnification
    this.canvas = null;
    this.ctx = null;
    this.active = false;
  }

  _ensureCanvas() {
    if (this.canvas) return true;
    if (typeof document === "undefined") return false;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = this.target;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    if (this.ctx) { this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = "high"; }
    return !!this.ctx;
  }

  /** Feed the landmarks of the previous frame to track where the body is. */
  update(landmarks) {
    if (!landmarks || !landmarks.length) return;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, n = 0;
    for (const lm of landmarks) {
      if (!lm) continue;
      const v = lm.visibility === undefined ? 1 : lm.visibility;
      if (v < 0.3) continue;
      x0 = Math.min(x0, lm.x); x1 = Math.max(x1, lm.x);
      y0 = Math.min(y0, lm.y); y1 = Math.max(y1, lm.y);
      n++;
    }
    if (n < 4 || x1 <= x0 || y1 <= y0) return;
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (!this.box) { this.box = box; return; }
    const s = this.smoothing;
    this.box = {
      x: s * this.box.x + (1 - s) * box.x,
      y: s * this.box.y + (1 - s) * box.y,
      w: s * this.box.w + (1 - s) * box.w,
      h: s * this.box.h + (1 - s) * box.h,
    };
  }

  /**
   * Produce the image the detector should look at this frame.
   * @returns {{source:*, map:(pt:{x:number,y:number})=>{x:number,y:number}, scale:number}}
   *          `source` is either the original video (no crop worthwhile) or an
   *          upscaled canvas; `map` converts detector output back to
   *          full-frame normalised coordinates.
   */
  frame(video, frameW, frameH) {
    const identity = { source: video, map: p => p, scale: 1 };
    if (!this.box || !this._ensureCanvas()) { this.active = false; return identity; }

    // square crop around the body box, with margin, clamped to the frame
    const cx = (this.box.x + this.box.w / 2) * frameW;
    const cy = (this.box.y + this.box.h / 2) * frameH;
    const side = Math.max(this.box.w * frameW, this.box.h * frameH) * (1 + 2 * this.margin);
    const s = Math.min(side, Math.min(frameW, frameH));
    let x = cx - s / 2, y = cy - s / 2;
    x = Math.max(0, Math.min(frameW - s, x));
    y = Math.max(0, Math.min(frameH - s, y));

    const upscale = this.target / s;
    if (!(upscale >= this.minUpscale)) { this.active = false; return identity; }

    this.ctx.drawImage(video, x, y, s, s, 0, 0, this.target, this.target);
    this.rect = { x, y, s };
    this.scale = upscale;
    this.active = true;
    return {
      source: this.canvas,
      scale: upscale,
      // detector coords are normalised to the CROP; put them back in frame space
      map: p => ({ ...p, x: (x + p.x * s) / frameW, y: (y + p.y * s) / frameH }),
    };
  }

  reset() { this.box = null; this.active = false; this.scale = 1; }
}

// ---------------------------------------------------------------------
// [4] Frame quality — is the picture good enough to work with?
// Downsamples the frame to 64x48 grey and measures:
//   brightness : mean luma            (too dark -> detection collapses)
//   contrast   : RMS around the mean  (washed out -> edges vanish)
//   sharpness  : mean |gradient|      (blur / out of focus)
// ---------------------------------------------------------------------
export class FrameQuality {
  constructor() {
    this.canvas = null; this.ctx = null;
    this.last = { brightness: 0, contrast: 0, sharpness: 0, score: 1 };
    this.everyN = 10; this.n = 0;
  }
  measure(source) {
    this.n++;
    if (this.n % this.everyN !== 1) return this.last;      // cheap: 1 frame in 10
    if (typeof document === "undefined") return this.last;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 64; this.canvas.height = 48;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!this.ctx) return this.last;
    try { this.ctx.drawImage(source, 0, 0, 64, 48); } catch { return this.last; }
    const d = this.ctx.getImageData(0, 0, 64, 48).data;
    const g = new Float32Array(64 * 48);
    let sum = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const y = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      g[p] = y; sum += y;
    }
    const mean = sum / g.length;
    let varSum = 0, grad = 0;
    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 63; x++) {
        const i = y * 64 + x;
        varSum += (g[i] - mean) ** 2;
        grad += Math.abs(g[i] - g[i - 1]) + Math.abs(g[i] - g[i - 64]);
      }
    }
    const contrast = Math.sqrt(varSum / g.length);
    const sharpness = grad / (62 * 46 * 2);
    // Map to a single 0..1 usability score. The constants are the points at
    // which landmark quality visibly degrades in our own testing.
    const b = Math.min(1, Math.max(0, (mean - 0.10) / 0.25));
    const c = Math.min(1, contrast / 0.18);
    const s = Math.min(1, sharpness / 0.045);
    this.last = { brightness: mean, contrast, sharpness,
                  score: Math.min(1, 0.45 * b + 0.30 * c + 0.25 * s) };
    return this.last;
  }
}

// ---------------------------------------------------------------------
// The pipeline object game.js actually talks to.
// ---------------------------------------------------------------------
export class LowResPipeline {
  constructor(opts = {}) {
    this.stab = new LandmarkStabilizer(opts.stabilizer);
    this.roi = new AdaptiveROI(opts.roi);
    this.quality = new FrameQuality();
    this.enabled = opts.enabled !== false;
    this.roiEnabled = opts.roi !== false;
    this.frameW = 0; this.frameH = 0;
    this.lowRes = false;       // true when the camera itself is low resolution
    this.lastQuality = { score: 1 };
    this.lastMap = p => p;
    this.missStreak = 0;       // consecutive frames with no detection
    this.roiCooldown = 0;      // frames to stay on the full frame after a miss streak
  }

  /** Call once the camera is up. */
  setFrameSize(w, h) {
    this.frameW = w; this.frameH = h;
    // 640x480 and below is where landmark quality starts to suffer.
    this.lowRes = (w > 0 && Math.min(w, h) <= 480);
  }

  /** Landmark jitter currently measured on this camera (0 = perfectly stable). */
  get jitter() { return this.stab.jitter; }

  /** Called at the top of every frame: returns what to hand the detector. */
  prepare(video) {
    if (!this.enabled || !this.frameW) { this.lastMap = p => p; return video; }
    this.lastQuality = this.quality.measure(video);
    // Safety valve: if cropping ever costs us the subject, fall back to the
    // full frame for a while rather than stalling the exercise.
    if (this.roiCooldown > 0) { this.roiCooldown--; this.roi.active = false; this.lastMap = p => p; return video; }
    if (!this.roiEnabled) { this.lastMap = p => p; return video; }
    const f = this.roi.frame(video, this.frameW, this.frameH);
    this.lastMap = f.map;
    return f.source;
  }

  /** Clean up one frame of landmarks (and remember the box for the next ROI). */
  stabilize(landmarks, tMs) {
    if (landmarks && landmarks.length) this.missStreak = 0;
    else if (++this.missStreak >= 5 && this.roi.active) {
      this.roi.reset(); this.roiCooldown = 45; this.missStreak = 0;
    }
    if (!this.enabled) return landmarks;
    const mapped = (landmarks && this.roi.active)
      ? landmarks.map(p => (p ? this.lastMap(p) : p))
      : landmarks;
    const out = this.stab.process(mapped || null, tMs);
    if (out) this.roi.update(out);
    this.fast = this.stab.fast;   // low-lag rail: used to DECIDE reps
    return out;                   // smooth rail: used to MEASURE them
  }

  /** Rep-counter thresholds, widened to match the measured camera noise. */
  thresholds(base) {
    if (!this.enabled) return base;
    return adaptHysteresis(base, this.stab.jitter);
  }

  /** Human-readable state for the UI badge. */
  status() {
    const q = this.lastQuality.score ?? 1;
    return {
      lowRes: this.lowRes,
      roiActive: this.roi.active,
      magnification: this.roi.active ? this.roi.scale : 1,
      jitter: this.stab.jitter,
      quality: q,
      bridged: this.stab.bridgedFrames,
      level: q > 0.75 ? "good" : (q > 0.45 ? "fair" : "poor"),
    };
  }

  reset() { this.stab.reset(); this.roi.reset(); }
}

export default LowResPipeline;
