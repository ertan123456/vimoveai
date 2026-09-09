/* ViMove — shared site behaviour (no build step, plain JS) */
(function () {
  "use strict";

  /* ---- Google Analytics (gtag) — initialised here to keep templates inline-script free ---- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", "G-4SV7FE09C2");

  /* ---- Mobile navigation toggle ---- */
  var header = document.getElementById("siteHeader");
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");

  if (header && toggle && links) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });

    // Close the menu after following an in-page link
    links.addEventListener("click", function (e) {
      if (e.target.closest("a") && header.classList.contains("open")) {
        header.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      }
    });
  }

  /* ---- Copy-to-clipboard (e.g. IBAN on the donate page) ---- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var text = (btn.getAttribute("data-copy") || "").replace(/\s+/g, " ").trim();
    var done = function () {
      var old = (window.viI18n && window.viI18n.t("donate.copiedLabel")) || "✓ Copied!";
      var prev = btn.innerHTML;
      btn.classList.add("is-copied");
      btn.innerHTML = old;
      setTimeout(function () { btn.innerHTML = prev; btn.classList.remove("is-copied"); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {});
    } else {
      var t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (err) {}
      document.body.removeChild(t);
    }
  });

  /* ---- Lightbox for the community gallery ---- */
  var lbImgs = [].slice.call(document.querySelectorAll("[data-lightbox]"));
  if (lbImgs.length) {
    var box = document.createElement("div");
    box.className = "lightbox";
    box.hidden = true;
    box.innerHTML =
      '<button class="lb-close" type="button" aria-label="Close">&times;</button>' +
      '<button class="lb-nav lb-prev" type="button" aria-label="Previous">&#8249;</button>' +
      '<img alt="">' +
      '<button class="lb-nav lb-next" type="button" aria-label="Next">&#8250;</button>';
    document.body.appendChild(box);
    var big = box.querySelector("img");
    var cur = 0;
    function show(i) { cur = (i + lbImgs.length) % lbImgs.length; big.src = lbImgs[cur].src; }
    function open(i) { show(i); box.hidden = false; document.body.style.overflow = "hidden"; }
    function close() { box.hidden = true; document.body.style.overflow = ""; big.src = ""; }
    lbImgs.forEach(function (im, i) { im.addEventListener("click", function () { open(i); }); });
    box.querySelector(".lb-close").addEventListener("click", close);
    box.querySelector(".lb-prev").addEventListener("click", function (e) { e.stopPropagation(); show(cur - 1); });
    box.querySelector(".lb-next").addEventListener("click", function (e) { e.stopPropagation(); show(cur + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(cur - 1);
      else if (e.key === "ArrowRight") show(cur + 1);
    });
  }

  /* ---- PWA: register the service worker (makes the site installable) ---- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  /* ---- Scroll-reveal for elements marked .reveal (progressive enhancement:
     styles.css only hides them once .has-js is present on <html>, which we
     set immediately below — so content stays fully visible if this script
     never runs). Direct children of .reveal-stagger get a staggered delay
     via the --reveal-i custom property instead of all firing at once. */
  document.documentElement.classList.add("has-js");

  // Mark stagger children as .reveal BEFORE collecting the target list below,
  // so every one of them actually gets observed (not just elements that had
  // .reveal in the markup already).
  document.querySelectorAll(".reveal-stagger").forEach(function (group) {
    [].slice.call(group.children).forEach(function (child, i) {
      child.classList.add("reveal");
      child.style.setProperty("--reveal-i", i);
    });
  });

  var revealTargets = [].slice.call(document.querySelectorAll(".reveal"));
  if (revealTargets.length) {
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
      revealTargets.forEach(function (el) { io.observe(el); });
    } else {
      revealTargets.forEach(function (el) { el.classList.add("is-visible"); });
    }
    // Safety net: this is a health app, so content must never stay stuck
    // invisible if the observer fails to fire for any reason (a paused
    // background tab, a browser quirk, etc.) — force it visible after a
    // few seconds no matter what.
    setTimeout(function () {
      revealTargets.forEach(function (el) { el.classList.add("is-visible"); });
    }, 4000);
  }
})();

/* ---- Academic evaluation letter modal (community page) ---- */
(function () {
  var openBtn = document.getElementById("letterOpen");
  var modal = document.getElementById("letterModal");
  if (!openBtn || !modal) return;
  var closeBtn = document.getElementById("letterClose");
  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (closeBtn) closeBtn.focus();
  }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  openBtn.addEventListener("click", open);
  if (closeBtn) closeBtn.addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) close();
  });
})();
