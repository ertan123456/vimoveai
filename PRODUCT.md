# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Older adults managing a movement-related condition — Parkinson's (primary focus), stroke recovery, arthritis, fall/balance risk, or general senior fitness — doing home exercise via a webcam, often with tremor, reduced vision, or limited tech confidence. Secondary audience: the Samsung Solve for Tomorrow jury/reviewers evaluating the project's credibility and real-world usage evidence.

## Product Purpose

ViMove is an AI movement-therapy web app: a webcam plus browser-side MediaPipe (hand/face/pose landmarks) builds and tracks a personalized exercise program, counts reps in real time, and scores movement quality (amplitude consistency, decrement, tempo, left/right symmetry) at the end of each session. Success = the user completes a correctly-counted, correctly-detected session and comes away with an honest, plain-language read on how their movement is trending — without needing a clinician in the room.

## Positioning

Two things a generic "AI fitness app" doesn't do: (1) every prescribed exercise is evidence-sourced per condition (real citations in `app/data/programs.json` — MDS-UPDRS, OARSI/ACR, Otago, WHO, etc.), not invented; (2) all pose/hand/face processing runs client-side in the browser (MediaPipe via JS) — no video ever leaves the device, which matters for an elderly/health-adjacent audience and for Play Store data-safety review.

## Operating Context

- Flow: home → pick condition (`/start`, disease + age + gender) → `/session` runs the webcam exercise program (game.js rep-detection engine) → end-of-session report card → `/progress` dashboard aggregates history from localStorage across sessions.
- No login/accounts yet; state lives in the URL (disease/age/gender query params) and localStorage (session history, language, voice toggle) — stateless server, safe for multi-user shared hosting.
- Bilingual UI (English default, Turkish auto-detected/toggleable) via `static/i18n.js`.
- Voice guidance (Web Speech API) announces exercises/reps/transitions, toggle-able.
- Deployed and live at https://vimoveai.com (Contabo VPS, nginx + gunicorn/systemd). Also packaged as an installable PWA, with Play Store TWA submission as a next step (needs `assetlinks.json` hosted + Play Console listing).

## Capabilities and Constraints

- Built and maintained by two high-school students (Erdem Ertan, Oğuz Çetinkaya) — stack choice favors simplicity/maintainability over frameworks.
- Stack: FastAPI + Jinja2 server-rendered pages, vanilla CSS/JS, no frontend build step, no bundler. Do not introduce a JS framework unless explicitly asked.
- Detection engine (`game.js`) uses a single generic rep state machine with per-exercise threshold config (hysteresis: separate engage/release thresholds), scale-invariant metrics, mirror-corrected left/right via `userSide()`.
- Program engine (`app/program_engine.py` + `app/data/programs.json`) is rule-based (not ML-personalized): expands sides, scales reps by age tier (Standard/Moderate/Gentle). Gender is collected but explicitly does **not** affect exercise selection — no evidence basis, stated transparently in-product.
- 5 active conditions today: Parkinson's, stroke, arthritis, balance/fall-prevention, general senior fitness. Neck/lower-back is deferred — requires new detector types (neck rotation, trunk lateral-bend) not yet built; shown as "coming soon."
- Movement-quality scoring is explicitly framed as **relative, within-person screening** — not a diagnostic or clinical measurement. This framing is a hard product constraint (also required for Play Store "not a medical device" review) — do not let future copy or UI imply clinical/diagnostic accuracy.
- Donate page exists (`/donate`, IBAN-only) but is deliberately disabled during the competition window (`DONATE_ENABLED = False` in `main.py`) — do not re-enable without the user's say-so.
- No user accounts/auth yet — explicitly deferred to after the current competition-driven priorities.

## Brand Commitments

- Name: **ViMove**. Palette: teal/blue clinical health tones (`#0d9488` theme color). Fonts: Lexend/Inter (Google Fonts).
- Visual direction: light, clinical, accessibility-first — large base type (~18px), high contrast, big touch targets — chosen specifically for elderly users with possible tremor or low vision. This is a locked design decision, not open for casual restyling.
- Community/proof page deliberately avoids the word "kanıt/proof" in its Turkish framing (user's explicit instruction) — uses "Sahada ViMove" / "ViMove in action" instead.
- Logos available: `ViMove_Logo_Amblem.svg`, `ViMove_Logo_Koyu.svg`, `ViMove_Logo_Yatay.svg` at repo root.

## Evidence on Hand

- `app/data/programs.json` carries per-condition exercise rationale with real cited sources (PMC papers, MDS-UPDRS, OARSI/ACR guidelines, Otago program, WHO senior fitness).
- `/community` page has a real photo gallery (9 usage photos) documenting actual use, built specifically as usage evidence for the Samsung Solve for Tomorrow submission.
- No clinician sign-off or formal accuracy-validation study exists yet — noted internally as the single highest-credibility gap remaining (rep-count accuracy vs. manual count, small pilot). Do not fabricate validation claims in copy; state this as a known absence.

## Product Principles

1. Every exercise prescribed must be evidence-based with a real citable source — never invent an exercise or claim.
2. Never overstate clinical/diagnostic accuracy — this is a screening/wellness tool, always framed as relative and within-person.
3. Design for the actual user in front of the camera: elderly, possibly tremoring, possibly low-vision — accessibility (large type, high contrast, big targets) is not optional polish.
4. Keep the stack simple and dependency-light (no build step) so two student maintainers can keep shipping without new toolchain overhead.
5. Privacy by architecture: video/pose processing stays client-side; nothing about a user's movement is uploaded.

## Accessibility & Inclusion

Primary users may have tremor, reduced fine motor control, and/or reduced vision (elderly, Parkinson's/stroke population). Required baseline: large base font size (~18px+), high contrast, large touch targets, and bilingual (Turkish/English) support with auto-detection. No other formal accessibility standard (e.g., WCAG level) has been explicitly committed to yet.
