/* ViMove — Google sign-in via Supabase.
   The anon key is public by design (safe to ship in the browser); user data is
   protected server-side by Supabase Row Level Security. No passwords touch us. */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

function meta(name) {
  const el = document.querySelector('meta[name="' + name + '"]');
  return (el && el.getAttribute("content")) || "";
}
// The server hands these down in <meta> tags, so moving the Supabase project
// is an environment change on the server and nothing else.
const SUPABASE_URL = meta("sb-url");
const SUPABASE_ANON_KEY = meta("sb-anon");

// Misconfigured server (no key yet)? Do not throw — the rest of the site,
// including the whole exercise flow, works without an account.
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
window.vimoveSupabase = supabase; // other scripts (progress sync) reuse this client
window.vimoveUser = null;
window.dispatchEvent(new Event("vimove:supabase-ready"));

const slot = document.getElementById("authSlot");

/* --- tiny i18n helper (mirrors i18n.js language choice) --- */
function lang() {
  try {
    return localStorage.getItem("vimove:lang") ||
      ((navigator.language || "en").toLowerCase().startsWith("tr") ? "tr" : "en");
  } catch (e) { return "en"; }
}
function t(en, tr) { return lang() === "tr" ? tr : en; }

/* --- helpers --- */
function displayName(user) {
  const m = user.user_metadata || {};
  return m.full_name || m.name || (user.email || "").split("@")[0] || "";
}
function firstName(user) { return (displayName(user).split(/\s+/)[0]) || t("Account", "Hesap"); }
function initials(user) {
  const s = (displayName(user) || user.email || "?").trim();
  const p = s.split(/\s+/);
  if (p.length >= 2 && p[0] && p[1]) return (p[0][0] + p[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// role -> dashboard path
function panelPath(role) {
  return role === "uzman" ? "/uzman" : role === "super_admin" ? "/admin" : "/hasta";
}
function panelLink() {
  const p = window.vimoveProfile;
  if (!p || !p.role) return "";
  const label = p.role === "uzman" ? t("Specialist panel", "Uzman paneli")
    : p.role === "super_admin" ? t("Admin panel", "Yönetim paneli")
    : t("My panel", "Panelim");
  return '<a href="' + panelPath(p.role) + '">' + label + "</a>";
}

/* classic anonymous profile silhouette for the signed-out button */
const PERSON_IC =
  '<svg class="auth-person" viewBox="0 0 24 24" width="22" height="22" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.7 3.2-5.9 7-5.9s7 2.2 7 5.9"/></svg>';

/* close any open account menu (module-level so it survives re-renders) */
function closeMenu() {
  const m = document.querySelector(".acct-menu");
  const c = document.querySelector(".acct-chip");
  if (m) m.setAttribute("hidden", "");
  if (c) c.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", function (e) { if (!e.target.closest(".acct")) closeMenu(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

/* --- actions --- */
async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin }
  });
  if (error) {
    alert(t(
      "Sign-in isn't available yet. Google login still needs to be enabled for this site.",
      "Giriş henüz hazır değil. Google girişinin bu site için etkinleştirilmesi gerekiyor."
    ));
  }
}
async function signOut() { await supabase.auth.signOut(); }

/* --- render nav state --- */
function render(session) {
  if (!slot) return;
  const user = session && session.user;

  if (!user) {
    const label = t("Sign in", "Giriş yap");
    slot.innerHTML =
      '<button class="auth-signin" type="button" aria-label="' + label + '" title="' + label + '">' +
      PERSON_IC + "</button>";
    slot.querySelector(".auth-signin").addEventListener("click", function () { location.href = "/giris"; });
    return;
  }

  slot.innerHTML =
    '<div class="acct">' +
      '<button class="acct-chip" type="button" aria-haspopup="true" aria-expanded="false">' +
        '<span class="acct-ini">' + esc(initials(user)) + "</span>" +
        '<span class="acct-name">' + esc(firstName(user)) + "</span>" +
        '<svg class="acct-caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
          '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</button>" +
      '<div class="acct-menu" hidden>' +
        '<span class="acct-email">' + esc(user.email || "") + "</span>" +
        panelLink() +
        '<a href="/progress">' + t("My progress", "İlerlemem") + "</a>" +
        '<button type="button" class="acct-signout">' + t("Sign out", "Çıkış yap") + "</button>" +
      "</div>" +
    "</div>";

  const chip = slot.querySelector(".acct-chip");
  const menu = slot.querySelector(".acct-menu");
  chip.addEventListener("click", function (e) {
    e.stopPropagation();
    const wasHidden = menu.hasAttribute("hidden");
    closeMenu();
    if (wasHidden) { menu.removeAttribute("hidden"); chip.setAttribute("aria-expanded", "true"); }
  });
  slot.querySelector(".acct-signout").addEventListener("click", signOut);
}

/* --- wire up --- */
// Draw the signed-out button FIRST, before a single network call. If Supabase
// is unreachable (a paused project resolves to nothing), getSession never
// settles and the nav used to be left with no sign-in icon at all.
render(null);

if (!supabase) {
  console.warn("ViMove: Supabase is not configured (sb-url / sb-anon meta tags).");
} else {

function apply(session) {
  const user = (session && session.user) || null;
  window.vimoveUser = user;
  window.vimoveProfile = null;
  render(session);
  window.dispatchEvent(new CustomEvent("vimove:auth", { detail: user }));
  if (!user) return;
  // IMPORTANT: never await a Supabase query directly inside the auth callback —
  // it deadlocks the auth lock and hangs. Defer it out with setTimeout(0).
  setTimeout(function () {
    supabase.from("profiles")
      .select("role,full_name,title,specialist_id").eq("id", user.id).single()
      .then(function (res) { window.vimoveProfile = (res && res.data) || null; })
      .catch(function () { window.vimoveProfile = null; })
      .then(function () {
        render(session);
        window.dispatchEvent(new CustomEvent("vimove:profile", { detail: window.vimoveProfile }));
      });
  }, 0);
}
supabase.auth.onAuthStateChange(function (_event, session) { apply(session); });
supabase.auth.getSession()
  .then(function (res) { apply(res.data.session); })
  .catch(function () { /* backend down: the signed-out button already stands */ });
window.addEventListener("vimove:lang", function () {
  supabase.auth.getSession()
    .then(function (res) { render(res.data.session); })
    .catch(function () { render(null); });
});
}
