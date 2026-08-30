/* ViMove — panel gate: verify the signed-in user's role, then reveal the shell.
   Data (patients, prescriptions, sessions) is protected server-side by Supabase RLS;
   this only decides which panel a user may see. */
(function () {
  "use strict";
  var body = document.body;
  var required = body.getAttribute("data-role"); // 'uzman' | 'hasta' | 'super_admin'

  function panelPath(role) {
    return role === "uzman" ? "/uzman" : role === "super_admin" ? "/admin" : "/hasta";
  }
  function whenSupabase(t) {
    return new Promise(function (res) {
      if (window.vimoveSupabase) return res(window.vimoveSupabase);
      var done = false;
      function on() { if (done) return; done = true; window.removeEventListener("vimove:supabase-ready", on); res(window.vimoveSupabase); }
      window.addEventListener("vimove:supabase-ready", on);
      setTimeout(function () { if (done) return; done = true; window.removeEventListener("vimove:supabase-ready", on); res(window.vimoveSupabase || null); }, t || 4000);
    });
  }
  function reveal() {
    var g = document.getElementById("panelGate"), s = document.getElementById("panelShell");
    if (g) g.hidden = true;
    if (s) s.hidden = false;
  }
  function go(url) { location.replace(url); }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]);
  }

  (async function () {
    var sb = await whenSupabase();
    if (!sb) { go("/"); return; }
    try {
      var sess = (await withTimeout(sb.auth.getSession(), 8000)).data.session;
      if (!sess) { go("/?login=1"); return; }
      var role = null;
      try {
        var r = await withTimeout(sb.from("profiles").select("role,full_name").eq("id", sess.user.id).single(), 8000);
        role = r.data && r.data.role;
        window.vimoveProfile = r.data || null;
      } catch (e) { /* fall through to default */ }
      if (!role) role = "hasta";
      if (role !== required) { go(panelPath(role)); return; }
      reveal();
      // Hand the page's init the session — via a context + event so it works
      // regardless of whether the inline panel script parsed before or after this.
      window.vimovePanelCtx = { sb: sb, sess: sess, role: role };
      window.dispatchEvent(new CustomEvent("vimove:panel-ready", { detail: window.vimovePanelCtx }));
    } catch (e) {
      go("/"); // auth hung/failed — bail to home instead of spinning forever
    }
  })();

  // mobile sidebar toggle + close on link tap
  document.addEventListener("click", function (e) {
    if (e.target.closest("#panelMenuBtn")) { body.classList.toggle("panel-side-open"); return; }
    if (e.target.closest(".panel-nav a")) { body.classList.remove("panel-side-open"); }
    else if (body.classList.contains("panel-side-open") && !e.target.closest(".panel-side")) { body.classList.remove("panel-side-open"); }
  });
})();
