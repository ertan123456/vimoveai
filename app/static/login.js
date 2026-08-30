/* ViMove — login page: username+password (patients) and Google (others).
   External file (CSP blocks inline scripts). Uses the Supabase client from auth.js. */
(function () {
  const TR = (localStorage.getItem("vimove:lang") || (navigator.language || "").slice(0, 2)) === "tr";
  const t = (en, tr) => (TR ? tr : en);
  const DOMAIN = "hasta.vimoveai.com";
  const slug = (u) => (u || "").trim().toLowerCase()
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");

  function whenSb() {
    return new Promise(function (res) {
      if (window.vimoveSupabase) return res(window.vimoveSupabase);
      window.addEventListener("vimove:supabase-ready", function () { res(window.vimoveSupabase); }, { once: true });
      setTimeout(function () { res(window.vimoveSupabase || null); }, 6000);
    });
  }

  // if already signed in, skip the login page
  whenSb().then(async function (sb) {
    if (!sb) return;
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) location.replace("/hasta");
    } catch (e) {}
  });

  const form = document.getElementById("loginForm");
  const err = document.getElementById("loginErr");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.textContent = "";
    const u = slug(document.getElementById("loginUser").value);
    const p = document.getElementById("loginPass").value;
    if (!u || !p) { err.textContent = t("Enter username and password.", "Kullanıcı adı ve şifre gir."); return; }
    const sb = await whenSb();
    if (!sb) { err.textContent = t("Connection error.", "Bağlantı hatası."); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const res = await sb.auth.signInWithPassword({ email: u + "@" + DOMAIN, password: p });
    btn.disabled = false;
    if (res.error) { err.textContent = t("Wrong username or password.", "Kullanıcı adı veya şifre hatalı."); return; }
    location.href = "/hasta";
  });

  document.getElementById("googleBtn").addEventListener("click", async function () {
    const sb = await whenSb();
    if (!sb) return;
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  });
})();
