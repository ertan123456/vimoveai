# ViMove

**AI-guided movement therapy that turns any webcam into a personal physiotherapy companion.**

ViMove builds a personalized, evidence-based exercise program from a person's age and condition, then uses on-device computer vision to track their movements in real time, validate form, and count repetitions automatically. It runs entirely in the browser — no installation, no special hardware, and the camera feed never leaves the device.

Live: **[vimoveai.com](https://vimoveai.com)**

---

## Why

Regular exercise and physiotherapy are core, evidence-based parts of managing conditions such as Parkinson's disease, post-stroke recovery, osteoarthritis and fall prevention. But for many older adults, getting to a clinic regularly is hard — transport, cost and appointment access all get in the way, so home exercise is often done incorrectly, partially, or not at all.

ViMove brings guided, tracked exercise into the living room and makes physical activity accessible to the people who need it most.

---

## Features

- **Real-time motion tracking** — hand, face and full-body landmark detection (500+ points per frame) running fully on-device.
- **Automatic rep counting** — a single, robust rep-detection state machine with hysteresis, temporal smoothing and debounce to avoid false counts.
- **Personalized programs** — exercise selection by condition and rep targets scaled by age, grounded in published clinical guidelines.
- **Live feedback & session report** — on-screen counter, progress bar and an end-of-session movement-quality summary (consistency, tempo, left/right symmetry).
- **Privacy by design** — all inference happens in the browser; the video stream is never uploaded.
- **Accessibility** — voice guidance for low-vision users, large type, high contrast, and a Turkish/English interface.

---

## Supported programs

| Program | Clinical basis |
|---|---|
| Parkinson's disease | Large-amplitude movement (LSVT BIG), strength, balance, facial mobility |
| Post-stroke rehabilitation | High-repetition, task-specific practice; bilateral symmetry |
| Osteoarthritis & joint mobility | Range-of-motion + low-load strengthening (OARSI / ACR) |
| Balance & fall prevention | Lower-limb strengthening core of the Otago programme |
| General senior fitness | WHO multicomponent activity for adults 65+ |

Exercise choices and starting rep targets are evidence-informed starting points, not a medical prescription.

---

# Tech stack

- **Backend:** Python, FastAPI, Jinja2 templates
- **Frontend:** vanilla JavaScript, HTML, CSS (no build step)
- **Computer vision:** Google MediaPipe Tasks Vision (Hand, Face, Pose Landmarkers) running in-browser via WebAssembly
- **Storage:** browser `localStorage` for progress history (no server-side database)

---

## Project structure

```
vimoveai/
├── app/
│   ├── main.py             # FastAPI app, routes, security headers
│   ├── program_engine.py   # Rule-based, age-scaled program generator
│   ├── data/
│   │   └── programs.json    # Evidence-based knowledge base (exercises, doses, sources)
│   ├── static/
│   │   ├── game/game.js     # Real-time CV engine + rep-counting state machine
│   │   ├── progress.js      # Progress dashboard (charts from local history)
│   │   ├── i18n.js          # Lightweight TR/EN localization
│   │   └── styles.css
│   └── templates/           # Server-rendered pages
├── requirements.txt
├── render.yaml              # Render deployment
├── passenger_wsgi.py        # cPanel/Passenger entry point
└── run.sh / run.bat
```

---

## Getting started

Requires Python 3.10+.

```bash
# 1. (optional) create a virtual environment
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. install dependencies
pip install -r requirements.txt

# 3. run the development server
uvicorn app.main:app --reload
```

Then open `http://127.0.0.1:8000` and allow camera access when prompted.

On Windows you can also use `run.bat`; on Linux/macOS, `run.sh`.

---

## How the rep-counting works

1. **Scale-invariant metrics.** Each exercise is reduced to a metric normalized by body, hand or face size (e.g. arm height ÷ torso length, eye aspect ratio, ankle offset ÷ hip width), so the result is independent of the user's height or distance from the camera.
2. **Rep state machine.** A movement is counted only when it completes a full *engage → release* cycle. Separate engage/release thresholds (hysteresis), a 5-frame moving average, and a 350 ms cooldown reject noise and double counts.
3. **Per-exercise calibration.** Sit-to-stand calibrates a standing reference over the first frames and confirms each rep with both body height and knee angle.
4. **Quality report.** Each rep's amplitude and duration are logged to produce a session summary: consistency, tempo, decrement, and left/right symmetry.

---

## Deployment

Deployment notes are included for three targets:

- `DEPLOY_RENDER.md` — Render (uses `render.yaml`)
- `DEPLOY_VPS.md` — generic VPS with Gunicorn/Uvicorn
- `DEPLOY_CPANEL.md` — shared hosting via Passenger (`passenger_wsgi.py`)

---

## Acknowledgements

ViMove was created by two high-school students as a research project. It is built on open-source work — most notably **Google MediaPipe** for landmark detection — and its programs are grounded in published clinical guidelines (LSVT BIG, Otago, WHO, OARSI/ACR, AHA/ASA). Development also made use of modern AI-assisted coding tools.

---

## Disclaimer

ViMove is an assistive movement-tracking tool and a student research project. It is **not a medical device** and does not provide diagnosis, treatment, or professional medical advice. Always consult a qualified healthcare professional before beginning any exercise program.

---

## License

Released under the [MIT License](LICENSE).

## Authors

- **Erdem Ertan** — erdemertan08@gmail.com
- **Oğuz Çetinkaya** — oguzcetinkaya1903@gmail.com
