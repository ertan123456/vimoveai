/* ViMove — specialist panel: patients, activity feed, messaging, prescriptions.
   External file (CSP blocks inline scripts). */
async function vimovePanel(sb, sess) {
  const me = sess.user.id;
  const TR = (localStorage.getItem("vimove:lang") || (navigator.language || "").slice(0, 2)) === "tr";
  const t = (en, tr) => (TR ? tr : en);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const patientsMap = {};
  let currentPatient = null, currentName = "";

  function fmtTime(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    const s = (Date.now() - d) / 1000;
    if (s < 60) return t("now", "şimdi");
    if (s < 3600) return Math.floor(s / 60) + " " + t("min", "dk");
    if (s < 86400) return Math.floor(s / 3600) + " " + t("h", "sa");
    return d.toLocaleDateString(TR ? "tr-TR" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  const ini = (name) => ((name || "?").trim().slice(0, 2) || "?").toUpperCase();

  /* ---- invite: a link the patient only has to tap ----
     The old flow was "copy this code, tell your patient to paste it into the
     right box". Elderly patients did not get that far, so the link now does
     everything: account, specialist link, program, straight into the session. */
  $("inviteCode").textContent = me;

  function copy(text) {
    try { navigator.clipboard.writeText(text); } catch (e) {}
  }
  function flash(btn) {
    const o = btn.textContent;
    btn.textContent = t("Copied", "Kopyalandı");
    setTimeout(() => (btn.textContent = o), 1500);
  }

  function buildInviteLink() {
    const name = ($("invName").value || "").trim();
    const prog = $("invProgram").value;
    const q = [];
    if (name) q.push("ad=" + encodeURIComponent(name));
    if (prog) q.push("program=" + encodeURIComponent(prog));
    const url = location.origin + "/katil/" + me + (q.length ? "?" + q.join("&") : "");
    $("inviteLink").value = url;
    const msg = TR
      ? "Merhaba" + (name ? " " + name : "") + ", ViMove AI egzersiz bağlantın hazır. Bağlantıya dokun, hesabın kendiliğinden oluşsun: " + url
      : "Hello" + (name ? " " + name : "") + ", here is your ViMove AI exercise link — one tap and your account is ready: " + url;
    $("waShare").href = "https://wa.me/?text=" + encodeURIComponent(msg);
    return url;
  }
  buildInviteLink();
  $("invName").addEventListener("input", buildInviteLink);
  $("invProgram").addEventListener("change", buildInviteLink);
  $("copyInvite").addEventListener("click", function () { copy(buildInviteLink()); flash(this); });
  $("copyCode").addEventListener("click", function () { copy(me); flash(this); });

  /* ---- greet the specialist by name ---- */
  (async function greet() {
    try {
      const { data } = await sb.from("profiles").select("full_name,title").eq("id", me).maybeSingle();
      const name = (data && data.full_name || "").trim();
      if (!name) return;
      const el = $("helloName");
      el.dataset.en = "Welcome, " + name;
      el.dataset.tr = "Hoş geldin, " + name;
      el.textContent = t("Welcome, ", "Hoş geldin, ") + name;
    } catch (e) { /* greeting is cosmetic */ }
  })();

  /* ---- exercise catalog, grouped by body region ----
     One flat list of 26 exercises made the specialist hunt line by line, so
     the catalogue is now collapsible sections. The flat CATALOG is still what
     the save code indexes into (data-i), it is just built from the groups. */
  const ICO = {
    neck: '<path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M8 12c0 3-3 3-3 6v4h14v-4c0-3-3-3-3-6"/>',
    arm: '<path d="M6 3v7a4 4 0 0 0 4 4h3"/><circle cx="6" cy="3" r="1.6"/><path d="M13 14l5-3M18 11l3 5-4 3"/>',
    trunk: '<circle cx="12" cy="4" r="2"/><path d="M12 6v8M8 9h8M9 21l3-7 3 7"/>',
    leg: '<circle cx="12" cy="3.5" r="2"/><path d="M12 5.5V12M9 12l-1 9M15 12l1 9"/>',
    hand: '<path d="M9 11V5a1.6 1.6 0 1 1 3.2 0v5m0-1V4a1.6 1.6 0 1 1 3.2 0v6m0-2a1.6 1.6 0 1 1 3.2 0v6a7 7 0 0 1-7 7h-1a7 7 0 0 1-7-7v-3a1.6 1.6 0 1 1 3.2 0"/>',
    face: '<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>',
  };
  const GROUPS = [
    { key: "neck", icon: ICO.neck, label: t("Neck", "Boyun"), items: [
      { kind: "neckturn", side: null, ad: t("Head Turn", "Başı Yana Çevirme"), hedef: 10 },
      { kind: "necktilt", side: "right", ad: t("Head Tilt Right", "Başı Sağ Omza Yaklaştırma"), hedef: 8 },
      { kind: "necktilt", side: "left", ad: t("Head Tilt Left", "Başı Sol Omza Yaklaştırma"), hedef: 8 },
      { kind: "neckflex", side: null, ad: t("Neck Flexion (chin to chest)", "Başı Öne Eğme"), hedef: 10 },
    ]},
    { key: "arm", icon: ICO.arm, label: t("Shoulder & arm", "Omuz & Kol"), items: [
      { kind: "arm", side: "right", ad: t("Right Forward Arm Raise", "Sağ Kolu Öne Kaldırma"), hedef: 8 },
      { kind: "arm", side: "left", ad: t("Left Forward Arm Raise", "Sol Kolu Öne Kaldırma"), hedef: 8 },
      { kind: "armabduct", side: "right", ad: t("Right Side Arm Raise", "Sağ Kolu Yana Kaldırma"), hedef: 8 },
      { kind: "armabduct", side: "left", ad: t("Left Side Arm Raise", "Sol Kolu Yana Kaldırma"), hedef: 8 },
      { kind: "elbow", side: "right", ad: t("Right Elbow Curl", "Sağ Dirsek Bükme"), hedef: 10 },
      { kind: "elbow", side: "left", ad: t("Left Elbow Curl", "Sol Dirsek Bükme"), hedef: 10 },
      { kind: "shrug", side: null, ad: t("Shoulder Shrug", "Omuz Silkme"), hedef: 10 },
    ]},
    { key: "trunk", icon: ICO.trunk, label: t("Trunk & lower back", "Gövde & Bel"), items: [
      { kind: "trunkbend", side: "right", ad: t("Side Bend Right", "Gövdeyi Sağa Eğme"), hedef: 8 },
      { kind: "trunkbend", side: "left", ad: t("Side Bend Left", "Gövdeyi Sola Eğme"), hedef: 8 },
    ]},
    { key: "leg", icon: ICO.leg, label: t("Legs & balance", "Bacak & Denge"), items: [
      { kind: "leg", side: "right", ad: t("Right Side Leg Raise", "Sağ Bacağı Yana Açma"), hedef: 10 },
      { kind: "leg", side: "left", ad: t("Left Side Leg Raise", "Sol Bacağı Yana Açma"), hedef: 10 },
      { kind: "kneeext", side: "right", ad: t("Right Seated Knee Extension", "Oturarak Sağ Dizi Açma"), hedef: 10 },
      { kind: "kneeext", side: "left", ad: t("Left Seated Knee Extension", "Oturarak Sol Dizi Açma"), hedef: 10 },
      { kind: "march", side: null, ad: t("Marching in Place", "Yerinde Yürüyüş"), hedef: 20 },
      { kind: "sitstand", side: null, ad: t("Sit to Stand", "Otur–Kalk"), hedef: 10 },
    ]},
    { key: "hand", icon: ICO.hand, label: t("Hand & fingers", "El & Parmak"), items: [
      { kind: "hand", side: "right", ad: t("Right Hand Open / Close", "Sağ El Açma–Kapama"), hedef: 12 },
      { kind: "hand", side: "left", ad: t("Left Hand Open / Close", "Sol El Açma–Kapama"), hedef: 12 },
      { kind: "fingertap", side: "right", ad: t("Right Thumb-to-Index Tap", "Sağ Parmak Ucu Dokunuşu"), hedef: 14 },
      { kind: "fingertap", side: "left", ad: t("Left Thumb-to-Index Tap", "Sol Parmak Ucu Dokunuşu"), hedef: 14 },
    ]},
    { key: "face", icon: ICO.face, label: t("Face & eyes", "Yüz & Göz"), items: [
      { kind: "mouth", side: null, ad: t("Mouth Open / Close", "Ağız Açma–Kapama"), hedef: 10 },
      { kind: "blink", side: "right", ad: t("Right Eye Blink", "Sağ Göz Kırpma"), hedef: 8 },
      { kind: "blink", side: "left", ad: t("Left Eye Blink", "Sol Göz Kırpma"), hedef: 8 },
    ]},
  ];

  const CATALOG = [];
  GROUPS.forEach(g => g.items.forEach(it => { it._i = CATALOG.length; CATALOG.push(it); }));

  $("prescList").innerHTML = GROUPS.map(g =>
    '<details class="presc-group" data-g="' + g.key + '">' +
      '<summary>' +
        '<span class="pg-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + g.icon + '</svg></span>' +
        '<span class="pg-label">' + esc(g.label) + '</span>' +
        '<span class="pg-sel" data-sel="' + g.key + '" hidden>0</span>' +
        '<span class="pg-n">' + g.items.length + '</span>' +
        '<svg class="pg-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
      '</summary>' +
      '<div class="presc-items">' + g.items.map(c =>
        '<label class="presc-item"><input type="checkbox" data-i="' + c._i + '"><span class="presc-name">' + esc(c.ad) +
        '</span><input type="number" class="presc-target" data-i="' + c._i + '" value="' + c.hedef + '" min="1" max="60"></label>'
      ).join("") + "</div>" +
    "</details>"
  ).join("") + '<div class="presc-foot"><span id="prescCount">' +
    t("0 exercises selected", "0 egzersiz seçildi") + '</span>' +
    '<button type="button" class="linkish" id="prescClear">' + t("Clear", "Temizle") + "</button></div>";

  function refreshPrescCounts() {
    let total = 0;
    GROUPS.forEach(function (g) {
      const n = g.items.filter(it => {
        const cb = document.querySelector('#prescList input[type="checkbox"][data-i="' + it._i + '"]');
        return cb && cb.checked;
      }).length;
      total += n;
      const badge = document.querySelector('[data-sel="' + g.key + '"]');
      if (badge) { badge.textContent = n; badge.hidden = n === 0; }
    });
    const c = $("prescCount");
    if (c) c.textContent = TR ? (total + " egzersiz seçildi") : (total + " exercise" + (total === 1 ? "" : "s") + " selected");
  }
  $("prescList").addEventListener("change", refreshPrescCounts);
  $("prescClear").addEventListener("click", function () {
    document.querySelectorAll('#prescList input[type="checkbox"]').forEach(c => (c.checked = false));
    refreshPrescCounts();
  });

  /* ---- loaders ---- */
  async function loadPatients() {
    const { data } = await sb.from("profiles").select("id,full_name").eq("specialist_id", me);
    const rows = $("patientRows");
    $("statPatients").textContent = (data && data.length) || 0;
    (data || []).forEach(p => (patientsMap[p.id] = p.full_name || t("(no name)", "(isimsiz)")));
    if (!data || !data.length) {
      rows.innerHTML = '<tr><td colspan="3" class="muted" style="padding:22px 12px">' +
        t("No patients yet. Share your invite code below.", "Henüz hasta yok. Aşağıdaki davet kodunu paylaş.") + "</td></tr>";
      return;
    }
    const { data: presc } = await sb.from("prescriptions").select("patient_id").eq("specialist_id", me).eq("active", true);
    const activeSet = {}; (presc || []).forEach(p => (activeSet[p.patient_id] = true));
    $("statActive").textContent = (presc || []).length;
    rows.innerHTML = data.map(function (p) {
      const name = patientsMap[p.id];
      const has = activeSet[p.id] ? '<span class="pill ok">' + t("Yes", "Var") + "</span>" : '<span class="pill mut">' + t("None", "Yok") + "</span>";
      return '<tr><td><span class="pt-name"><span class="pt-ini">' + ini(name) + "</span>" + esc(name) + "</span></td><td>" + has + "</td>" +
        '<td style="text-align:right"><button class="btn btn--secondary plink-btn" data-pid="' + p.id +
        '" style="min-height:38px;padding:8px 12px;margin-right:6px">' + t("Link", "Bağlantı") + "</button>" +
        '<button class="btn btn--secondary detail-btn" data-pid="' + p.id + '" data-name="' + esc(name) +
        '" style="min-height:38px;padding:8px 14px">' + t("Details", "Detay") + "</button></td></tr>";
    }).join("");
  }

  async function loadActivity() {
    let data = [];
    try { const r = await sb.from("sessions").select("user_id,created_at,data").order("created_at", { ascending: false }).limit(15); data = r.data || []; } catch (e) {}
    data = data.filter(s => s.user_id !== me); // patients only
    const feed = $("activityFeed");
    if (!data.length) return; // keep empty state
    // count sessions in last 7 days
    const wk = Date.now() - 7 * 864e5;
    $("statSessions").textContent = data.filter(s => new Date(s.created_at) >= wk).length;
    feed.innerHTML = data.slice(0, 10).map(function (s) {
      const d = s.data || {}; const name = patientsMap[s.user_id] || t("Patient", "Hasta");
      const metrics =
        '<span class="metric">' + t("Reps", "Tekrar") + ' <b>' + (d.reps != null ? d.reps + "/" + d.target : "—") + "</b></span>" +
        '<span class="metric">' + t("Score", "Skor") + ' <b>' + (d.overall != null ? d.overall + "/100" : "—") + "</b></span>" +
        '<span class="metric">' + t("Consistency", "Tutarlılık") + ' <b>' + (d.consistency != null ? "%" + d.consistency : "—") + "</b></span>";
      return '<div class="feed-item"><div class="feed-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg></div>' +
        '<div class="feed-main"><div class="feed-top"><span class="feed-title">' + esc(name) + " · " + esc(d.name || t("Session", "Seans")) +
        '</span><span class="feed-time">' + fmtTime(s.created_at) + "</span></div>" +
        '<div class="feed-metrics">' + metrics + "</div>" +
        (d.note ? '<div class="ainote">🤖 ' + esc(d.note) + "</div>" : "") + "</div></div>";
    }).join("");
  }

  async function loadInbox() {
    let data = [];
    try { const r = await sb.from("messages").select("id,sender_id,body,read,created_at").eq("recipient_id", me).order("created_at", { ascending: false }).limit(25); data = r.data || []; } catch (e) {}
    const unread = data.filter(m => !m.read).length;
    $("statUnread").textContent = unread;
    const badge = $("chatBadge");
    if (badge) { if (unread > 0) { badge.textContent = unread; badge.hidden = false; } else badge.hidden = true; }
    if (!data.length) return;
    const html = data.map(function (m) {
      const name = patientsMap[m.sender_id] || t("Patient", "Hasta");
      return '<div class="inbox-item' + (m.read ? "" : " unread") + '" data-pid="' + m.sender_id + '" data-name="' + esc(name) + '">' +
        '<span class="inbox-dot"></span><div class="inbox-body"><div class="inbox-title">' + esc(name) +
        '<span class="feed-time" style="float:right">' + fmtTime(m.created_at) + "</span></div>" +
        '<div class="inbox-prev">' + esc(m.body) + "</div></div></div>";
    }).join("");
    $("inbox").innerHTML = html;
    const ci = $("chatInbox"); if (ci) ci.innerHTML = html;
  }

  /* ---- messaging ---- */
  async function loadThread(pid) {
    const box = $("detailThread");
    let data = [];
    try {
      const r = await sb.from("messages").select("sender_id,body,created_at")
        .or(`and(sender_id.eq.${me},recipient_id.eq.${pid}),and(sender_id.eq.${pid},recipient_id.eq.${me})`)
        .order("created_at", { ascending: true }).limit(200);
      data = r.data || [];
    } catch (e) {}
    if (!data.length) { box.innerHTML = '<div class="thread-empty">' + t("No messages yet.", "Henüz mesaj yok.") + "</div>"; return; }
    box.innerHTML = data.map(m =>
      '<div class="msg ' + (m.sender_id === me ? "out" : "in") + '">' + esc(m.body) +
      '<span class="msg-time">' + fmtTime(m.created_at) + "</span></div>").join("");
    box.scrollTop = box.scrollHeight;
    // mark incoming as read
    try { await sb.from("messages").update({ read: true }).eq("recipient_id", me).eq("sender_id", pid).eq("read", false); } catch (e) {}
    loadInbox();
  }
  async function sendMsg(pid, text) {
    if (!text.trim()) return;
    try { await sb.from("messages").insert({ sender_id: me, recipient_id: pid, body: text.trim() }); } catch (e) {}
    loadThread(pid);
  }

  /* ---- patient detail modal ---- */
  async function openDetail(pid, name) {
    currentPatient = pid; currentName = name;
    $("detailName").textContent = name;
    // active prescription
    let presc = null;
    try { const r = await sb.from("prescriptions").select("title,program,note").eq("patient_id", pid).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(); presc = r.data; } catch (e) {}
    $("detailPresc").innerHTML = presc && presc.program
      ? '<strong>' + esc(presc.title || t("Prescription", "Reçete")) + "</strong> — " +
        presc.program.map(x => esc(x.ad) + " (" + x.hedef + ")").join(", ") + (presc.note ? '<div class="muted" style="margin-top:4px">' + esc(presc.note) + "</div>" : "")
      : '<span class="muted">' + t("No active prescription.", "Aktif reçete yok.") + "</span>";
    // recent sessions
    let sessions = [];
    try { const r = await sb.from("sessions").select("created_at,data").eq("user_id", pid).order("created_at", { ascending: false }).limit(6); sessions = r.data || []; } catch (e) {}
    $("detailSessions").innerHTML = sessions.length ? sessions.map(function (s) {
      const d = s.data || {};
      return '<div class="feed-item"><div class="feed-main"><div class="feed-top"><span class="feed-title">' + esc(d.name || t("Session", "Seans")) +
        '</span><span class="feed-time">' + fmtTime(s.created_at) + '</span></div><div class="feed-metrics">' +
        '<span class="metric">' + t("Reps", "Tekrar") + " <b>" + (d.reps != null ? d.reps + "/" + d.target : "—") + "</b></span>" +
        '<span class="metric">' + t("Score", "Skor") + " <b>" + (d.overall != null ? d.overall : "—") + "</b></span>" +
        '<span class="metric">' + t("Consistency", "Tutarlılık") + " <b>" + (d.consistency != null ? "%" + d.consistency : "—") + "</b></span></div>" +
        (d.note ? '<div class="ainote">🤖 ' + esc(d.note) + "</div>" : "") +
        (d.video ? '<button class="btn btn--secondary watch-video" data-path="' + esc(d.video) + '" style="margin-top:9px;min-height:34px;padding:6px 14px;font-size:.88rem"><svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> ' + t("Watch video", "Videoyu izle") + "</button>" : "") +
        "</div></div>";
    }).join("") : '<span class="muted">' + t("No sessions yet.", "Henüz seans yok.") + "</span>";
    // thread
    await loadThread(pid);
    $("detailModal").hidden = false;
  }

  async function openVideo(path) {
    try {
      const { data } = await sb.storage.from("session-videos").createSignedUrl(path, 3600);
      if (data && data.signedUrl) { $("videoPlayer").src = data.signedUrl; $("videoModal").hidden = false; return; }
    } catch (e) {}
    alert(t("Video not available.", "Video bulunamadı."));
  }
  function closeVideo() {
    const vm = $("videoModal"); if (!vm) return;
    vm.hidden = true;
    const vp = $("videoPlayer"); if (vp) { try { vp.pause(); } catch (e) {} vp.removeAttribute("src"); vp.load(); }
  }

  /* ---- prescription modal ---- */
  function openPresc(pid, name) {
    currentPatient = pid; currentName = name;
    $("prescFor").textContent = t("Prescription for ", "Reçete: ") + name;
    $("detailModal").hidden = true;
    $("prescModal").hidden = false;
  }
  $("prescSave").addEventListener("click", async function () {
    if (!currentPatient) return;
    const program = [];
    document.querySelectorAll("#prescList .presc-item").forEach(function (item) {
      const cb = item.querySelector('input[type="checkbox"]'); if (!cb.checked) return;
      const i = +cb.getAttribute("data-i"); const tgt = +item.querySelector(".presc-target").value || CATALOG[i].hedef;
      program.push({ kind: CATALOG[i].kind, side: CATALOG[i].side, hedef: tgt, ad: CATALOG[i].ad });
    });
    if (!program.length) { alert(t("Pick at least one exercise.", "En az bir egzersiz seç.")); return; }
    const title = $("prescTitle").value.trim() || t("Prescription", "Reçete");
    const note = $("prescNote").value.trim();
    await sb.from("prescriptions").update({ active: false }).eq("patient_id", currentPatient).eq("specialist_id", me).eq("active", true);
    const { error } = await sb.from("prescriptions").insert({ patient_id: currentPatient, specialist_id: me, title: title, program: program, note: note, active: true });
    if (error) { alert(t("Could not save: ", "Kaydedilemedi: ") + error.message); return; }
    $("prescModal").hidden = true;
    $("prescTitle").value = ""; $("prescNote").value = "";
    document.querySelectorAll('#prescList input[type="checkbox"]').forEach(c => (c.checked = false));
    refreshPrescCounts();
    loadPatients();
    alert(t("Prescription saved ✅", "Reçete verildi ✅"));
  });

  /* ---- create patient (username + password, server-side) ---- */
  function genPass() { return "vm" + Math.random().toString(36).slice(2, 7); }
  const npModal = $("newPatientModal");
  if ($("newPatientBtn")) $("newPatientBtn").addEventListener("click", function () {
    $("npResult").hidden = true; $("npName").value = ""; $("npUser").value = ""; $("npPass").value = genPass(); npModal.hidden = false;
  });
  if ($("npGen")) $("npGen").addEventListener("click", function () { $("npPass").value = genPass(); });
  if ($("npCreate")) $("npCreate").addEventListener("click", async function () {
    const name = $("npName").value.trim();
    const user = $("npUser").value.trim().toLowerCase()
      .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
      .replace(/[^a-z0-9]/g, "");
    const pass = $("npPass").value;
    if (user.length < 3 || pass.length < 6) { alert(t("Username ≥3, password ≥6 characters.", "Kullanıcı adı en az 3, şifre en az 6 karakter.")); return; }
    const btn = $("npCreate"); btn.disabled = true;
    let j = {};
    try {
      const token = (await sb.auth.getSession()).data.session.access_token;
      const res = await fetch("/api/create-patient", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass, full_name: name, access_token: token })
      });
      j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        const m = j.error === "exists" ? t("Username is taken. Try another.", "Bu kullanıcı adı alınmış. Başka dene.")
          : j.error === "not_configured" ? t("Server not configured yet.", "Sunucu henüz yapılandırılmamış.")
          : t("Could not create the account. Please try again.", "Hesap oluşturulamadı. Tekrar dene.");
        alert(m); btn.disabled = false; return;
      }
    } catch (e) { alert(t("Network error.", "Bağlantı hatası.")); btn.disabled = false; return; }
    btn.disabled = false;
    $("npResult").hidden = false;
    $("npResult").textContent = t("Created ✅  Give the patient — username: ", "Oluşturuldu ✅  Hastaya ver — kullanıcı adı: ") + j.username + "  ·  " + t("password: ", "şifre: ") + pass;
    loadPatients();
  });

  /* ---- events ---- */
  const fab = $("chatFab"), pop = $("chatPop");
  if (fab) fab.addEventListener("click", function () { pop.hidden = !pop.hidden; if (!pop.hidden) loadInbox(); });
  const chatClose = $("chatClose"); if (chatClose) chatClose.addEventListener("click", function () { pop.hidden = true; });

  document.addEventListener("click", function (e) {
    const wv = e.target.closest(".watch-video"); if (wv) { openVideo(wv.getAttribute("data-path")); return; }
    if (e.target.closest("[data-close]") || e.target.classList.contains("pmodal")) {
      $("prescModal").hidden = true; $("detailModal").hidden = true; $("newPatientModal").hidden = true; closeVideo(); return;
    }
    const d = e.target.closest(".detail-btn"); if (d) { openDetail(d.getAttribute("data-pid"), d.getAttribute("data-name")); return; }
    const pl = e.target.closest(".plink-btn");
    if (pl) {
      // the patient's own link: one tap signs them in and shows their prescription
      (async function () {
        const o = pl.textContent;
        pl.textContent = "…";
        try {
          const token = (await sb.auth.getSession()).data.session.access_token;
          const r = await fetch("/api/patient-link", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: token, patient_id: pl.getAttribute("data-pid") }),
          });
          const out = await r.json();
          if (!out || !out.ok) { pl.textContent = o; alert(t("Could not create the link.", "Bağlantı alınamadı.")); return; }
          copy(location.origin + out.path);
          pl.textContent = t("Copied", "Kopyalandı");
        } catch (err) {
          pl.textContent = o;
          alert(t("Could not create the link.", "Bağlantı alınamadı."));
          return;
        }
        setTimeout(function () { pl.textContent = o; }, 1600);
      })();
      return;
    }
    const inb = e.target.closest(".inbox-item"); if (inb) { if (pop) pop.hidden = true; openDetail(inb.getAttribute("data-pid"), inb.getAttribute("data-name")); return; }
    if (e.target.closest("#detailPrescribe")) { openPresc(currentPatient, currentName); }
  });
  $("detailMsgForm").addEventListener("submit", function (e) {
    e.preventDefault();
    const inp = $("detailMsgInput");
    if (currentPatient) { sendMsg(currentPatient, inp.value); inp.value = ""; }
  });

  /* ---- initial + polling ---- */
  await loadPatients();
  loadActivity();
  loadInbox();
  setInterval(function () {
    loadInbox();
    if (!$("detailModal").hidden && currentPatient) loadThread(currentPatient);
  }, 15000);
}

/* run once panel.js has the session (CSP-safe external file, polls for shared ctx) */
(function () {
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (window.vimovePanelCtx) {
      clearInterval(timer);
      Promise.resolve(vimovePanel(window.vimovePanelCtx.sb, window.vimovePanelCtx.sess))
        .catch(function (err) { var el = document.getElementById("inviteCode"); if (el) el.textContent = "HATA: " + (err && err.message || err); });
    } else if (tries > 120) { clearInterval(timer); }
  }, 100);
})();
