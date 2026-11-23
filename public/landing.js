// If you're already signed in, skip "Login" and point the buttons at your inboxes.
(async () => {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return;
    const session = await res.json();
    const home = session.user?.role === "admin" ? "/admin/" : "/app/";
    document.querySelectorAll("[data-signed-out]").forEach((el) => { el.hidden = true; });
    document.querySelectorAll("[data-open-app]").forEach((el) => { el.textContent = "Open inbox"; el.href = home; });
    document.querySelectorAll("[data-open-app-small]").forEach((el) => { el.href = "/app/"; });
    document.querySelectorAll("[data-open-app-cta]").forEach((el) => { el.textContent = "Open your inboxes"; el.href = "/app/"; });
  } catch {
    // Offline or not signed in: keep the defaults.
  }
})();

// Pricing in the visitor's currency, with a switcher for the others.
(() => {
  const priceEls = document.querySelectorAll("[data-price]");
  const yearlyEls = document.querySelectorAll("[data-price-yearly]");
  const zeroEls = document.querySelectorAll("[data-price-zero]");
  const switcher = document.getElementById("currency-switch");
  if (!switcher) return;
  let prices = {
    USD: { symbol: "$", amount: 5, yearly: 50 },
    GBP: { symbol: "£", amount: 4, yearly: 40 },
    EUR: { symbol: "€", amount: 5, yearly: 50 },
  };
  const show = (currency) => {
    const price = prices[currency];
    if (!price) return;
    priceEls.forEach((el) => { el.textContent = `${price.symbol}${price.amount}`; });
    yearlyEls.forEach((el) => { el.textContent = `${price.symbol}${price.yearly}`; });
    zeroEls.forEach((el) => { el.textContent = `${price.symbol}0`; });
    switcher.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.currency === currency)));
  };
  switcher.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-currency]");
    if (button) show(button.dataset.currency);
  });
  fetch("/api/pricing", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((pricing) => {
      if (!pricing) return;
      prices = pricing.prices;
      show(pricing.currency);
    })
    .catch(() => {});
})();

// Highlight the nav link for the section in view.
const links = [...document.querySelectorAll('.lp-links a[href^="#"]')];
const sections = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
if ("IntersectionObserver" in window && sections.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`));
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach((s) => observer.observe(s));
}

// Mobile menu: the section links drop down from the nav.
const menuButton = document.querySelector(".lp-menu-btn");
if (menuButton) {
  const navEl = document.querySelector(".lp-nav");
  const setMenu = (open) => {
    navEl.classList.toggle("menu-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close menu" : "Menu");
  };
  menuButton.addEventListener("click", () => setMenu(!navEl.classList.contains("menu-open")));
  document.querySelectorAll(".lp-links a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  document.addEventListener("click", (e) => { if (!navEl.contains(e.target)) setMenu(false); });
}

// Nav follows the page; tighten it up once you've scrolled.
const nav = document.querySelector(".lp-nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Rocket flight: in from the lower left with the engine on, engine powers down on the
// approach, it coasts through a loop-the-loop in the middle, then the engine relights
// and it zooms off to the upper right. Built from the hero's size so it fits any screen.
(() => {
  const rocket = document.querySelector(".rocket-flight");
  const hero = document.querySelector(".hero");
  if (!rocket || !hero || !CSS.supports("offset-path", 'path("M0 0")') || !rocket.animate) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const trail = rocket.querySelector(".rocket-trail");
  const engine = rocket.querySelector(".rocket-engine");

  // Durations in ms for each leg of the flight.
  const ENTRY = 4600; // flying in; the engine winds down over its last stretch
  const POWER_DOWN = 1700; // how long the trail takes to die out
  const LOOP = 2300; // coasting through the loop
  const RELIGHT = 450; // engine bursts back on
  const EXIT = 1700; // zooming away
  const REST = 6000; // empty hero before the next pass
  const CYCLE = ENTRY + LOOP + EXIT + REST;

  const measure = (d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    return path.getTotalLength();
  };

  let running = [];

  const build = () => {
    running.forEach((a) => a.cancel());

    const w = hero.clientWidth;
    const h = hero.clientHeight;
    // On phones the loop is centred on the screen; on wider screens it sits just under the headline.
    const narrow = w < 760;
    const r = Math.round(narrow ? Math.min(90, w * 0.2) : Math.min(150, h * 0.18, w * 0.16));
    const px = Math.round(w * 0.5);
    const py = Math.round(narrow ? h * 0.44 + r : h * 0.62); // py is the bottom of the loop
    // On phones the rocket comes in higher, level with the intro text instead of near the bottom.
    const startY = Math.round(h * (narrow ? 0.6 : 0.86));
    const start = `M -320 ${startY}`;
    const entry = `C ${Math.round(w * 0.18)} ${startY - Math.round(h * 0.02)} ${px - 260} ${py} ${px} ${py}`;
    const loop = `A ${r} ${r} 0 1 0 ${px} ${py - 2 * r} A ${r} ${r} 0 1 0 ${px} ${py}`;
    const exit = `C ${px + 260} ${py} ${Math.round(w * 0.78)} ${Math.round(h * 0.3)} ${w + 760} ${Math.round(h * 0.12)}`;

    const entryLen = measure(`${start} ${entry}`);
    const loopLen = 2 * Math.PI * r;
    const total = entryLen + loopLen + measure(`M ${px} ${py} ${exit}`);
    const pct = (len) => `${((len / total) * 100).toFixed(3)}%`;
    const at = (ms) => ms / CYCLE;

    rocket.style.offsetPath = `path("${start} ${entry} ${loop} ${exit}")`;
    rocket.classList.add("on-path");

    const timing = { duration: CYCLE, iterations: Infinity, delay: 1500 };
    const loopStart = at(ENTRY);
    const loopEnd = at(ENTRY + LOOP);

    running = [
      // Position: slows as the engine cuts out, coasts the loop, then accelerates away.
      rocket.animate(
        [
          { offset: 0, offsetDistance: "0%", easing: "cubic-bezier(0.2, 0.1, 0.45, 1)" },
          { offset: loopStart, offsetDistance: pct(entryLen), easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)" },
          { offset: loopEnd, offsetDistance: pct(entryLen + loopLen), easing: "cubic-bezier(0.55, 0, 0.9, 0.5)" },
          { offset: at(ENTRY + LOOP + EXIT), offsetDistance: "100%" },
          { offset: 1, offsetDistance: "100%" },
        ],
        timing,
      ),
      // Trail: shrinks back toward the nozzle and fades as the engine powers down,
      // stays off through the loop, then bursts back out.
      trail.animate(
        [
          { offset: 0, opacity: 1, transform: "scale(1)" },
          { offset: at(ENTRY - POWER_DOWN), opacity: 1, transform: "scale(1)", easing: "ease-in" },
          { offset: loopStart, opacity: 0, transform: "scale(0.25)" },
          { offset: loopEnd, opacity: 0, transform: "scale(0.25)", easing: "ease-out" },
          { offset: at(ENTRY + LOOP + RELIGHT), opacity: 1, transform: "scale(1.15)" },
          { offset: at(ENTRY + LOOP + RELIGHT * 2), opacity: 1, transform: "scale(1)" },
          { offset: 1, opacity: 1, transform: "scale(1)" },
        ],
        timing,
      ),
      // Flame: dies down with the trail and flares back up on relight.
      engine.animate(
        [
          { offset: 0, opacity: 1, transform: "scale(1)" },
          { offset: at(ENTRY - POWER_DOWN * 0.6), opacity: 1, transform: "scale(1)", easing: "ease-in" },
          { offset: loopStart, opacity: 0, transform: "scale(0.2)" },
          { offset: loopEnd, opacity: 0, transform: "scale(0.2)", easing: "ease-out" },
          { offset: at(ENTRY + LOOP + RELIGHT * 0.6), opacity: 1, transform: "scale(1.5)" },
          { offset: at(ENTRY + LOOP + RELIGHT * 1.6), opacity: 1, transform: "scale(1)" },
          { offset: 1, opacity: 1, transform: "scale(1)" },
        ],
        timing,
      ),
    ];
  };

  build();
  let timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(build, 150);
  });
})();
