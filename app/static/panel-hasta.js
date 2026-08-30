async function vimovePanel(sb, sess) {
  const me = sess.user.id;
  const TR = (localStorage.getItem("vimove:lang") || (navigator.language || "").slice(0, 2)) === "tr";
  const t = (en, tr) => (TR ? tr : en);

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function fmtTime(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    const s = (Date.now() - d) / 1000;
    if (s < 60) return t("now", "şimdi");
    if (s < 3600) return Math.floor(s / 60) + " " + t("min", "dk");
    if (s < 86400) return Math.floor(s / 3600) + " " + t("h", "sa");
    return d.toLocaleDateString(TR ? "tr-TR" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  // profile / linking status
  let linked = false, specialistId = null;
  try {
    const { data } = await sb.from("profiles").select("specialist_id").eq("id", me).single();
    specialistId = data && data.specialist_id;
    linked = !!specialistId;
  } catch (e) {}
  const linkCard = document.getElementById("linkCard");
  if (!linked) linkCard.hidden = false;

  document.getElementById("linkBtn").addEventListener("click", async function () {
    const code = document.getElementById("linkCode").value.trim();
    if (!code) return;
    const { error } = await sb.from("profiles").update({ specialist_id: code }).eq("id", me);
    if (error) { alert(t("Code not found or invalid.", "Kod bulunamadı ya da geçersiz.")); return; }
    alert(t("Connected to your specialist ✅", "Uzmanına bağlandın ✅"));
    location.reload();
  });

  // active prescription
  try {
    const { data } = await sb.from("prescriptions")
      .select("title,program,note,created_at")
      .eq("patient_id", me).eq("active", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data && Array.isArray(data.program) && data.program.length) {
      document.getElementById("rxEmpty").hidden = true;
      const body = document.getElementById("rxBody");
      const items = data.program.map((e, i) =>
        '<li><span class="rx-num">' + (i + 1) + "</span>" +
        '<span class="rx-name">' + (e.ad || e.kind) + "</span>" +
        '<span class="rx-goal">' + (e.hedef || "") + " " + t("reps", "tekrar") + "</span></li>"
      ).join("");
      body.innerHTML =
        '<h3 style="margin:0 0 4px;font-size:1.1rem">' + (data.title || t("Prescription", "Reçete")) + "</h3>" +
        (data.note ? '<p class="muted" style="margin:0 0 12px">' + data.note + "</p>" : "") +
        '<ul class="rx-list">' + items + "</ul>" +
        '<a href="/session" class="btn btn--primary" style="margin-top:16px">' +
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        "<span>" + t("Start this program", "Bu programı başlat") + "</span></a>";
      body.hidden = false;
    }
  } catch (e) {}

  // ---- messaging: floating chat bubble with the specialist ----
  const threadEl = document.getElementById("hastaThread");
  const msgForm = document.getElementById("hastaMsgForm");
  const fab = document.getElementById("chatFab");
  const pop = document.getElementById("chatPop");
  const badge = document.getElementById("chatBadge");
  if (specialistId && fab) fab.hidden = false;

  async function updateBadge() {
    if (!specialistId || !badge) return;
    try {
      const { count } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("recipient_id", me).eq("read", false);
      if (typeof count === "number" && count > 0) { badge.textContent = count; badge.hidden = false; }
      else badge.hidden = true;
    } catch (e) {}
  }
  async function loadThread() {
    if (!specialistId) { threadEl.innerHTML = '<div class="thread-empty">' + t("Connect to your specialist to message.", "Mesajlaşmak için önce uzmanına bağlan.") + "</div>"; return; }
    let data = [];
    try {
      const r = await sb.from("messages").select("sender_id,body,created_at")
        .or(`and(sender_id.eq.${me},recipient_id.eq.${specialistId}),and(sender_id.eq.${specialistId},recipient_id.eq.${me})`)
        .order("created_at", { ascending: true }).limit(200);
      data = r.data || [];
    } catch (e) {}
    if (!data.length) { threadEl.innerHTML = '<div class="thread-empty">' + t("No messages yet. Say hello 👋", "Henüz mesaj yok. Bir merhaba de 👋") + "</div>"; }
    else {
      threadEl.innerHTML = data.map(m => '<div class="msg ' + (m.sender_id === me ? "out" : "in") + '">' + esc(m.body) + '<span class="msg-time">' + fmtTime(m.created_at) + "</span></div>").join("");
      threadEl.scrollTop = threadEl.scrollHeight;
    }
    try { await sb.from("messages").update({ read: true }).eq("recipient_id", me).eq("sender_id", specialistId).eq("read", false); } catch (e) {}
    updateBadge();
  }
  if (fab) fab.addEventListener("click", function () { pop.hidden = !pop.hidden; if (!pop.hidden) loadThread(); });
  const chatClose = document.getElementById("chatClose");
  if (chatClose) chatClose.addEventListener("click", function () { pop.hidden = true; });
  if (msgForm) msgForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const inp = document.getElementById("hastaMsgInput"); const txt = inp.value.trim();
    if (!txt) return;
    if (!specialistId) { alert(t("Connect to your specialist first.", "Önce uzmanına bağlan.")); return; }
    inp.value = "";
    try { await sb.from("messages").insert({ sender_id: me, recipient_id: specialistId, body: txt }); } catch (e) {}
    loadThread();
  });
  updateBadge();
  setInterval(function () { updateBadge(); if (pop && !pop.hidden) loadThread(); }, 15000);
}
(function () {
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.vimovePanelCtx) {
      clearInterval(timer);
      Promise.resolve(vimovePanel(window.vimovePanelCtx.sb, window.vimovePanelCtx.sess)).catch(function (e) { console.error("panel init:", e); });
    } else if (tries > 120) { clearInterval(timer); }
  }, 100);
})();
