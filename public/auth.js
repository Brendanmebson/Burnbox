// Sign-in and sign-up pages. The page sets <body data-auth="login"> or "signup".
(() => {
  "use strict";

  const mode = document.body.dataset.auth;
  const form = document.getElementById("auth-form");
  const errorEl = document.getElementById("form-error");

  const params = new URLSearchParams(location.search);
  const nextParam = params.get("next") || "";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const homeFor = (role) => next || (role === "admin" ? "/admin/" : "/app/");

  // Already signed in? Skip this page.
  fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then((session) => { if (session) location.replace(homeFor(session.user.role)); })
    .catch(() => {});

  // Show the monthly price in the visitor's currency.
  const priceEls = document.querySelectorAll("[data-price]");
  if (priceEls.length) {
    fetch("/api/pricing", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((pricing) => {
        const price = pricing?.prices?.[pricing.currency];
        if (price) priceEls.forEach((el) => { el.textContent = `${price.symbol}${price.amount}`; });
      })
      .catch(() => {});
  }

  // ---------- Repeat-signup signals ----------
  // A random ID kept in this browser's storage (the server also sets a matching cookie).
  const deviceId = () => {
    try {
      let id = localStorage.getItem("tb_device");
      if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
        id = crypto.randomUUID().replace(/-/g, "");
        localStorage.setItem("tb_device", id);
      }
      return id;
    } catch {
      return "";
    }
  };

  // A hash of stable browser traits. It never leaves the browser in readable form.
  const fingerprint = async () => {
    const n = navigator;
    const parts = [
      n.userAgent.replace(/[\d.]+/g, ""), // ignore version numbers so browser updates don't change it
      n.language,
      (n.languages || []).join(","),
      n.platform,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      window.devicePixelRatio,
      n.hardwareConcurrency,
      n.deviceMemory,
      n.maxTouchPoints,
    ];
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 60;
      const g = canvas.getContext("2d");
      g.textBaseline = "top";
      g.font = "16px Arial";
      g.fillStyle = "#f60";
      g.fillRect(100, 5, 80, 30);
      g.fillStyle = "#069";
      g.fillText("Burnbox ✉ 482913", 4, 8);
      g.strokeStyle = "rgba(120, 40, 200, 0.6)";
      g.arc(50, 30, 20, 0, Math.PI * 1.5);
      g.stroke();
      parts.push(canvas.toDataURL());
    } catch { /* canvas blocked */ }
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (info) parts.push(gl.getParameter(info.UNMASKED_VENDOR_WEBGL), gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    } catch { /* WebGL unavailable */ }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  };

  // ---------- Submit ----------
  const clearErrors = () => {
    errorEl.replaceChildren();
    form.querySelectorAll(".input.invalid").forEach((el) => el.classList.remove("invalid"));
  };
  form.addEventListener("input", (event) => event.target.classList?.remove("invalid"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();
    if (!form.reportValidity()) return;

    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = mode === "signup" ? "Creating your account…" : "Signing in…";

    const data = Object.fromEntries(new FormData(form));
    data.device_id = deviceId();
    data.fingerprint = await fingerprint().catch(() => "");

    try {
      const res = await fetch(`/api/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        location.assign(homeFor(body.role));
        return;
      }
      errorEl.textContent = body.error || `Something went wrong (${res.status}). Try again.`;
      if (body.code === "repeat_signup") {
        const link = document.createElement("a");
        link.href = "/login/";
        link.textContent = "Go to sign in";
        errorEl.append(" ", link);
      }
      const field = body.field && form.elements[body.field];
      if (field) {
        field.classList.add("invalid");
        field.focus();
      }
    } catch {
      errorEl.textContent = "Network error. Check your connection and try again.";
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
})();
