/* ViMove AI — the patient's own page (/p/<id>/<sig>).
   Signs them in from the link (no password), shows the prescription their
   specialist wrote, and starts the session. External file: CSP blocks inline. */
(function () {
  var wrap = document.getElementById("progWrap");
  if (!wrap) return;

  var tokenHash = wrap.dataset.token || "";
  var program = wrap.dataset.program || "";
  var yas = wrap.dataset.yas || "";
  var loading = document.getElementById("progLoading");
  var ready = document.getElementById("progReady");
  var failed = document.getElementById("progFail");

  function show(el) {
    loading.hidden = true; ready.hidden = true; failed.hidden = true;
    el.hidden = false;
  }
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };

  function client() {
    if (window.vimoveSupabase) return Promise.resolve(window.vimoveSupabase);
    return new Promise(function (res) {
      var done = false;
      window.addEventListener("vimove:supabase-ready", function () {
        if (!done) { done = true; res(window.vimoveSupabase); }
      }, { once: true });
      setTimeout(function () { if (!done) { done = true; res(window.vimoveSupabase || null); } }, 8000);
    });
  }

  function startHref(hasPrescription) {
    // With a prescription the session page loads it itself; without one we
    // hand it the recommended program so the patient still gets a real plan.
    if (hasPrescription) return "/session";
    var p = program || "general";
    return "/session?disease=" + encodeURIComponent(p) + "&age=" + encodeURIComponent(yas || "65");
  }

  (async function run() {
    var sb = await client();
    if (!sb) return show(failed);

    // already signed in on this device? then the one-shot token is not needed
    var session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) {}

    if (!session && tokenHash) {
      try {
        var r = await sb.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
        session = r && r.data ? r.data.session : null;
      } catch (e) { /* falls through to the failure card */ }
    }
    if (!session) return show(failed);

    var uid = session.user.id;

    // name + active prescription
    var name = "", presc = null;
    try {
      var pr = await sb.from("profiles").select("full_name").eq("id", uid).maybeSingle();
      name = (pr.data && pr.data.full_name || "").trim();
    } catch (e) {}
    try {
      var qr = await sb.from("prescriptions")
        .select("title,program,note")
        .eq("patient_id", uid).eq("active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      presc = qr.data || null;
    } catch (e) {}

    document.getElementById("progName").textContent = name ? "Merhaba " + name : "Merhaba";

    var list = document.getElementById("progList");
    if (presc && Array.isArray(presc.program) && presc.program.length) {
      document.getElementById("progTag").textContent = "Fizyoterapistinin programı";
      document.getElementById("progTitle").textContent = presc.title || "Egzersiz programın";
      document.getElementById("progSub").textContent =
        "Fizyoterapistin senin için " + presc.program.length + " egzersiz seçti.";
      if (presc.note) {
        var n = document.getElementById("progNote");
        n.textContent = presc.note; n.hidden = false;
      }
      list.innerHTML = presc.program.map(function (e) {
        return '<li><span class="pl-name">' + esc(e.ad) + '</span>' +
               '<span class="pl-target">' + (e.hedef || 8) + ' tekrar</span></li>';
      }).join("");
      document.getElementById("progStart").dataset.href = startHref(true);
    } else {
      // no prescription yet — show the recommended program instead
      document.getElementById("progTag").textContent = "Önerilen egzersizler";
      document.getElementById("progSub").textContent =
        "Fizyoterapistin henüz program yazmadı; o zamana kadar bu programla başlayabilirsin.";
      var slug = program || "general";
      try {
        var res = await fetch("/api/program?disease=" + encodeURIComponent(slug) + "&age=" + encodeURIComponent(yas || "65"));
        var prog = await res.json();
        document.getElementById("progTitle").textContent = prog.name_tr || prog.name || "Önerilen program";
        list.innerHTML = (prog.exercises || []).map(function (e) {
          return '<li><span class="pl-name">' + esc(e.ad_tr || e.ad) + '</span>' +
                 '<span class="pl-target">' + (e.hedef || 8) + ' tekrar</span></li>';
        }).join("");
      } catch (e) {
        document.getElementById("progTitle").textContent = "Önerilen program";
      }
      document.getElementById("progStart").dataset.href = startHref(false);
    }

    document.getElementById("progStart").addEventListener("click", function () {
      window.location.href = this.dataset.href || "/session";
    });
    show(ready);
  })();
})();
