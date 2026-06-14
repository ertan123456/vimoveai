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
})();
