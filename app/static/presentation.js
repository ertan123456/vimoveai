/* ViMove AI — presentation stage (/sunum)
   Slide navigation for the live talk. External file on purpose: the site's
   CSP blocks inline scripts. */
(function () {
  var stage = document.getElementById("stage");
  if (!stage) return;

  var slides = [].slice.call(stage.querySelectorAll(".slide"));
  var dotsWrap = document.getElementById("stageDots");
  var hint = document.getElementById("stageHint");
  var prevBtn = document.getElementById("stagePrev");
  var nextBtn = document.getElementById("stageNext");
  var index = 0;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- dots ---- */
  var dots = slides.map(function (s, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", "Slayt " + (i + 1));
    b.addEventListener("click", function (e) { e.stopPropagation(); go(i); });
    dotsWrap.appendChild(b);
    return b;
  });

  /* ---- count-up: the hero number animates the first time its slide shows ---- */
  function countUp(el) {
    if (el.dataset.done === "1") return;
    el.dataset.done = "1";
    var target = parseFloat(el.dataset.count);
    var decimals = parseInt(el.dataset.decimals || "0", 10);
    var fmt = function (v) { return v.toFixed(decimals).replace(".", ","); };
    if (reduce) { el.textContent = fmt(target); return; }
    var start = performance.now(), dur = 1400;
    (function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);        // ease-out
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(step);
    })(start);
    // Backstop: requestAnimationFrame is paused in a background tab, and this
    // number must never be left sitting at zero in front of an audience.
    setTimeout(function () { el.textContent = fmt(target); }, dur + 400);
  }

  function go(i) {
    if (i < 0 || i >= slides.length || i === index) return;
    slides[index].classList.remove("is-active");
    dots[index].classList.remove("is-on");
    index = i;
    slides[index].classList.add("is-active");
    dots[index].classList.add("is-on");
    if (history.replaceState) history.replaceState(null, "", "#" + slides[index].id);
    activate();
  }
  function activate() {
    var nums = slides[index].querySelectorAll("[data-count]");
    [].forEach.call(nums, countUp);
  }
  var next = function () { go(index + 1); };
  var prev = function () { go(index - 1); };

  /* ---- controls ---- */
  if (nextBtn) nextBtn.addEventListener("click", function (e) { e.stopPropagation(); next(); });
  if (prevBtn) prevBtn.addEventListener("click", function (e) { e.stopPropagation(); prev(); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(slides.length - 1);
  });

  // clicking the stage advances, so a presenter can use a clicker
  stage.addEventListener("click", function (e) {
    if (e.target.closest("a, button")) return;
    next();
  });

  // touch swipe
  var x0 = null;
  stage.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 60) (dx < 0 ? next : prev)();
    x0 = null;
  }, { passive: true });

  /* ---- start on the slide named in the URL (#sorun / #cozum) ---- */
  var startId = (location.hash || "").replace("#", "");
  var startIdx = slides.findIndex(function (s) { return s.id === startId; });
  if (startIdx > 0) {
    slides[0].classList.remove("is-active");
    slides[startIdx].classList.add("is-active");
    index = startIdx;
  }
  dots[index].classList.add("is-on");
  activate();

  if (hint) setTimeout(function () { hint.classList.add("is-gone"); }, 6000);
})();
