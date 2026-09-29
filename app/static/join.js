/* ViMove AI — invite link landing (/katil/<token>).
   One press: create the patient account, sign in, go straight to the exercise.
   External file because the site's CSP blocks inline scripts. */
(function () {
  var card = document.getElementById("joinCard");
  if (!card) return;

  var token = card.dataset.token;
  var program = card.dataset.program || "";
  var yas = card.dataset.yas || "";
  var startBtn = document.getElementById("joinStart");
  var errEl = document.getElementById("joinErr");
  var startLabel = startBtn.innerHTML;     // restored if the attempt fails

  function target() {
    if (program) {
      return "/session?disease=" + encodeURIComponent(program) +
             (yas ? "&age=" + encodeURIComponent(yas) : "");
    }
    return "/start";   // no program in the link: let them pick one
  }

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

  startBtn.addEventListener("click", async function () {
    errEl.hidden = true;
    startBtn.disabled = true;
    startBtn.classList.add("is-busy");
    startBtn.textContent = "Hesabın oluşturuluyor…";

    var name = (document.getElementById("joinName").value || "").trim();
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

    // sign in with the credentials we just received
    var sb = await client();
    if (sb) {
      try {
        await sb.auth.signInWithPassword({ email: out.email, password: out.password });
      } catch (e) { /* the credentials still work at /giris */ }
    }

    document.getElementById("joinUser").textContent = out.username;
    document.getElementById("joinPass").textContent = out.password;
    document.getElementById("joinStep1").hidden = true;
    document.getElementById("joinStep2").hidden = false;
    document.getElementById("joinContinue").focus();
  });

  document.getElementById("joinContinue").addEventListener("click", function () {
    window.location.href = target();
  });
})();
