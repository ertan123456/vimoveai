/* ViMove AI — invite link landing (/katil/<token>).
   First visit: create the patient's account and send them to their own page.
   Later visits from the same device: send them to that SAME account instead
   of opening a second one. External file because the CSP blocks inline. */
(function () {
  var card = document.getElementById("joinCard");
  if (!card) return;

  var SAVED = "vimove:patientPath";
  var token = card.dataset.token;
  var program = card.dataset.program || "";
  var yas = card.dataset.yas || "";
  var startBtn = document.getElementById("joinStart");
  var errEl = document.getElementById("joinErr");
  var startLabel = startBtn.innerHTML;     // restored if the attempt fails
  var again = document.getElementById("joinAgain");

  function query() {
    var q = [];
    if (program) q.push("program=" + encodeURIComponent(program));
    if (yas) q.push("yas=" + encodeURIComponent(yas));
    return q.length ? "?" + q.join("&") : "";
  }
  function goTo(path) { window.location.href = path + query(); }

  function fail(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    startBtn.disabled = false;
    startBtn.classList.remove("is-busy");
    startBtn.innerHTML = startLabel;       // not "creating your account…" forever
  }

  // The Supabase client is created by auth.js; it may not be ready yet.
  function client() {
    if (window.vimoveSupabase) return Promise.resolve(window.vimoveSupabase);
    return new Promise(function (res) {
      var done = false;
      window.addEventListener("vimove:supabase-ready", function () {
        if (!done) { done = true; res(window.vimoveSupabase); }
      }, { once: true });
      setTimeout(function () { if (!done) { done = true; res(window.vimoveSupabase || null); } }, 6000);
    });
  }

  /* ---------- returning patient? ----------
     Tapping the same invite link a second time used to open a second account.
     Two ways we recognise the person: the path stored on the first visit, and
     failing that, whoever is signed in on this device. "?yeni=1" skips both,
     for when a second person really is using the same tablet. */
  (async function recognise() {
    if (/[?&]yeni=1/.test(location.search)) return;

    var saved = null;
    try { saved = localStorage.getItem(SAVED); } catch (e) {}
    if (saved && saved.indexOf("/p/") === 0) { goTo(saved); return; }

    var sb = await client();
    if (!sb) return;
    var session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
    if (!session) return;
    try {
      var r = await fetch("/api/my-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      var out = await r.json();
      if (out && out.ok && out.path) {
        try { localStorage.setItem(SAVED, out.path); } catch (e) {}
        goTo(out.path);
      }
    } catch (e) { /* fall through to the normal flow */ }
  })();

  if (again) {
    again.addEventListener("click", function (e) {
      e.preventDefault();
      try { localStorage.removeItem(SAVED); } catch (e2) {}
      location.href = location.pathname + (location.search ? location.search + "&" : "?") + "yeni=1";
    });
  }

  /* ---------- first visit: create the account ---------- */
  startBtn.addEventListener("click", async function () {
    errEl.hidden = true;
    startBtn.disabled = true;
    startBtn.classList.add("is-busy");
    startBtn.textContent = "Hesabın oluşturuluyor…";

    var nameEl = document.getElementById("joinName");
    var name = (nameEl.value || "").trim();
    if (!name) {
      // the name is what reconnects a returning patient to their account
      fail("Lütfen adını yaz — hesabını bu isimle buluyoruz.");
      nameEl.focus();
      return;
    }
    var res, out;
    try {
      res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, full_name: name }),
      });
      out = await res.json();
    } catch (e) {
      return fail("Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.");
    }

    if (!res.ok || !out || !out.ok) {
      var code = (out && out.error) || "";
      if (code === "bad_token") return fail("Bu davet bağlantısı geçerli değil. Fizyoterapistinden yeni bir bağlantı iste.");
      if (code === "rate_limited") return fail("Bu bağlantı çok sık kullanıldı. Biraz sonra tekrar dene.");
      return fail("Hesap oluşturulamadı. Lütfen tekrar dene.");
    }

    // Remember this account on this device too, then hand over to the
    // patient's own page. `existing` means the server matched this link to an
    // account it had already created — there is no password to sign in with,
    // and none is needed: the personal page mints its own one-shot token.
    try { localStorage.setItem(SAVED, out.path); } catch (e) {}

    if (!out.existing && out.password) {
      var sb = await client();
      if (sb) {
        try {
          await sb.auth.signInWithPassword({ email: out.email, password: out.password });
        } catch (e) { /* the personal link signs them in on its own anyway */ }
      }
    }
    goTo(out.path || "/hasta");
  });
})();
