/* ViMove — progress dashboard. Reads session history from localStorage and
   renders summary tiles + trend charts + a recent-sessions list. No backend. */
(function () {
  "use strict";

  const root = document.getElementById("progressRoot");
  if (!root) return;

  const L = {
    en: {
      emptyTitle: "No sessions yet",
      emptyDesc: "Complete an exercise session and your results will show up here automatically.",
      emptyCta: "Start a session",
      sessions: "Sessions", lastScore: "Last score", bestScore: "Best score", avgReps: "Avg reps",
      chartScore: "Overall score", chartSym: "Left/right symmetry", chartReps: "Reps per session",
      recent: "Recent sessions", colDate: "Date", colProgram: "Program", colScore: "Score", colReps: "Reps",
      clear: "Clear history", confirm: "Delete all saved sessions on this device?",
    },
    tr: {
      emptyTitle: "Henüz seans yok",
      emptyDesc: "Bir egzersiz seansını tamamla; sonuçların burada otomatik olarak görünecek.",
      emptyCta: "Seans başlat",
      sessions: "Seans", lastScore: "Son skor", bestScore: "En iyi skor", avgReps: "Ort. tekrar",
      chartScore: "Genel skor", chartSym: "Sol/sağ simetri", chartReps: "Seans başına tekrar",
      recent: "Son seanslar", colDate: "Tarih", colProgram: "Program", colScore: "Skor", colReps: "Tekrar",
      clear: "Geçmişi temizle", confirm: "Bu cihazdaki tüm kayıtlı seanslar silinsin mi?",
    }
  };
  const DISEASE = {
    parkinson: ["Parkinson's disease", "Parkinson hastalığı"],
    stroke: ["Post-stroke rehab", "İnme rehabilitasyonu"],
    arthritis: ["Osteoarthritis", "Osteoartrit"],
    balance: ["Fall prevention", "Düşme önleme"],
    general: ["General fitness", "Genel kondisyon"],
  };
  const lang = () => (window.viI18n && window.viI18n.lang) || "en";
  const t = k => (L[lang()] || L.en)[k];
  const diseaseName = (slug, fallback) => (DISEASE[slug] ? DISEASE[slug][lang() === "tr" ? 1 : 0] : (fallback || slug || "—"));

  function readHistory() {
    try { return JSON.parse(localStorage.getItem("vimove:history") || "[]"); }
    catch (e) { return []; }
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(lang() === "tr" ? "tr-TR" : "en-GB",
      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  // Inline-SVG line chart (uniform scaling via viewBox)
  function lineChart(vals, color, max) {
    const w = 600, h = 150, pad = 22;
    if (!vals.length) return "";
    const mx = max != null ? max : Math.max.apply(null, vals.concat([1]));
    const n = vals.length;
    const X = i => pad + (n === 1 ? (w - 2 * pad) / 2 : i * (w - 2 * pad) / (n - 1));
    const Y = v => h - pad - (v / (mx || 1)) * (h - 2 * pad);
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = line + ` L ${X(n - 1).toFixed(1)} ${h - pad} L ${X(0).toFixed(1)} ${h - pad} Z`;
    const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="#fff" stroke="${color}" stroke-width="2.5"/>`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img">
      <path d="${area}" fill="${color}" fill-opacity="0.10"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  }

  function chartCard(label, vals, color, max, lastSuffix) {
    const last = vals.length ? vals[vals.length - 1] : "—";
    return `<div class="card chart-card">
      <div class="chart-head"><span class="chart-label">${label}</span><span class="chart-last">${last}${lastSuffix || ""}</span></div>
      ${lineChart(vals, color, max)}
    </div>`;
  }

  function render() {
    const hist = readHistory();

    if (!hist.length) {
      root.innerHTML = `<div class="card msg-card" style="margin:0 auto">
        <div class="msg-icon brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg></div>
        <h2 style="font-size:1.5rem">${t("emptyTitle")}</h2>
        <p class="lead">${t("emptyDesc")}</p>
        <div class="actions"><a href="/start" class="btn btn--primary">${t("emptyCta")}</a></div>
      </div>`;
      return;
    }

    const scores = hist.map(h => h.overall);
    const syms = hist.map(h => h.symmetry);
    const reps = hist.map(h => h.reps);
    const best = Math.max.apply(null, scores);
    const lastScore = scores[scores.length - 1];
    const avgReps = Math.round(reps.reduce((a, b) => a + b, 0) / reps.length);

    const tiles = `<div class="report-tiles" style="margin-bottom:22px">
      <div class="tile"><span class="tile-val">${hist.length}</span><span class="tile-lab">${t("sessions")}</span></div>
      <div class="tile"><span class="tile-val">${lastScore}</span><span class="tile-lab">${t("lastScore")}</span></div>
      <div class="tile"><span class="tile-val">${best}</span><span class="tile-lab">${t("bestScore")}</span></div>
      <div class="tile"><span class="tile-val">${avgReps}</span><span class="tile-lab">${t("avgReps")}</span></div>
    </div>`;

    const charts = `<div class="charts-grid">
      ${chartCard(t("chartScore"), scores, "#0d9488", 100, "/100")}
      ${chartCard(t("chartSym"), syms, "#2563eb", 100, "%")}
      ${chartCard(t("chartReps"), reps, "#7c3aed", null, "")}
    </div>`;

    const rows = hist.slice().reverse().slice(0, 20).map(h => `<div class="rrow">
      <span class="rrow-name">${fmtDate(h.when)}</span>
      <span class="rrow-cell">${diseaseName(h.disease, h.name)}</span>
      <span class="rrow-cell"><b>${h.overall}</b>/100</span>
      <span class="rrow-cell">${h.reps}/${h.target}</span>
    </div>`).join("");

    const list = `<div class="card" style="margin-top:22px">
      <div class="chart-head" style="margin-bottom:12px"><h3 style="margin:0;font-size:1.1rem">${t("recent")}</h3>
        <button id="clearHist" class="btn btn--ghost" style="min-height:38px;padding:7px 14px;font-size:.9rem">${t("clear")}</button></div>
      <div class="report-rows">
        <div class="rrow rrow-head"><span class="rrow-name">${t("colDate")}</span><span class="rrow-cell">${t("colProgram")}</span><span class="rrow-cell">${t("colScore")}</span><span class="rrow-cell">${t("colReps")}</span></div>
        ${rows}
      </div>
    </div>`;

    root.innerHTML = tiles + charts + list;
    const clr = document.getElementById("clearHist");
    if (clr) clr.addEventListener("click", () => {
      if (confirm(t("confirm"))) { localStorage.removeItem("vimove:history"); render(); }
    });
  }

  render();
  document.addEventListener("vimove:lang", render);  // re-render on language switch
})();
