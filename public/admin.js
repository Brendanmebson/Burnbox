// Admin dashboard: totals, every account, and plan controls.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /** Builds elements with text nodes only: user-supplied strings are never parsed as HTML. */
  const h = (tag, attrs, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  };

  const state = { users: [], filter: "all", search: "", now: Date.now() };

  let toastTimer;
  const toast = (text) => {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  };

  const api = async (path, { method = "GET", body } = {}) => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      location.replace(`/login/?next=${encodeURIComponent("/admin/")}`);
      throw new Error("Signed out");
    }
    if (res.status === 403 && path.startsWith("/admin")) {
      location.replace("/app/");
      throw new Error("Admins only");
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  };

  // ---------- Formatting ----------
  const DAY = 24 * 3600 * 1000;
  const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const ago = (ts) => {
    if (!ts) return "Never";
    const diff = state.now - ts;
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < DAY) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
    return shortDate(ts);
  };
  const left = (ts) => {
    const ms = ts - state.now;
    if (ms <= 0) return "ended";
    const days = Math.ceil(ms / DAY);
    return ms < DAY ? `${Math.ceil(ms / 3_600_000)}h left` : `${days} day${days === 1 ? "" : "s"} left`;
  };
  const flag = (country) =>
    country && /^[A-Z]{2}$/.test(country)
      ? String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
      : "";

  // ---------- Rendering ----------
  const planLabel = (u) => {
    if (u.disabled) return { cls: "disabled", name: "Disabled", detail: "Can't sign in" };
    switch (u.plan) {
      case "admin": return { cls: "admin", name: "Admin", detail: "" };
      case "pro": return { cls: "pro", name: "Pro", detail: `until ${shortDate(u.pro_until)}` };
      case "trial": return { cls: "trial", name: "Trial", detail: left(u.trial_ends_at) };
      default: return { cls: "expired", name: "Trial ended", detail: shortDate(u.trial_ends_at) };
    }
  };

  const act = async (user, action, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      const { user: updated } = await api(`/admin/users/${user.id}`, { method: "POST", body: { action } });
      if (updated) {
        const old = state.users.find((u) => u.id === user.id);
        Object.assign(old, updated);
      }
      render();
      toast("Saved");
    } catch (error) {
      toast(error.message);
    }
  };

  const remove = async (user) => {
    if (!confirm(`Delete ${user.email}? Their inboxes and emails are deleted too. This can't be undone.`)) return;
    try {
      await api(`/admin/users/${user.id}`, { method: "DELETE" });
      state.users = state.users.filter((u) => u.id !== user.id);
      render();
      toast("Account deleted");
    } catch (error) {
      toast(error.message);
    }
  };

  const actionsFor = (u) => {
    if (u.role === "admin") return [h("span", { class: "muted" }, "You")];
    const btn = (label, onclick, extra = "") => h("button", { class: `mini-btn ${extra}`.trim(), type: "button", onclick }, label);
    const out = [];
    if (u.plan === "pro") {
      out.push(btn("+1 month Pro", () => act(u, "grant_pro")));
      out.push(btn("+1 year Pro", () => act(u, "grant_pro_year")));
      out.push(btn("Remove Pro", () => act(u, "revoke_pro", `Remove Pro from ${u.email}?`)));
    } else {
      out.push(btn("Give 1 month Pro", () => act(u, "grant_pro"), "primary"));
      out.push(btn("Give 1 year Pro", () => act(u, "grant_pro_year")));
      out.push(btn("+7 days trial", () => act(u, "extend_trial")));
    }
    out.push(
      u.disabled
        ? btn("Enable", () => act(u, "enable"))
        : btn("Disable", () => act(u, "disable", `Disable ${u.email}? They'll be signed out and can't sign in.`)),
    );
    out.push(btn("Delete", () => remove(u), "danger"));
    return out;
  };

  const matches = (u) => {
    const f = state.filter;
    if (f === "disabled" && !u.disabled) return false;
    if (f !== "all" && f !== "disabled" && (u.plan !== f || u.disabled)) return false;
    const q = state.search;
    return !q || u.email.includes(q) || (u.name || "").toLowerCase().includes(q);
  };

  const render = () => {
    const rows = state.users.filter(matches);
    $("users-empty").hidden = rows.length > 0;
    $("users-body").replaceChildren(
      ...rows.map((u) => {
        const plan = planLabel(u);
        return h(
          "tr",
          {},
          h("td", { class: "td-account" }, h("div", { class: "u-email" }, u.email), u.name ? h("div", { class: "u-name muted" }, u.name) : null),
          h("td", { "data-label": "Plan" }, h("span", { class: `plan-badge ${plan.cls}` }, plan.name), plan.detail ? h("div", { class: "u-sub muted" }, plan.detail) : null),
          h("td", { class: "num", "data-label": "Inboxes" }, String(u.active_inboxes ?? 0)),
          h("td", { "data-label": "Joined" }, shortDate(u.created_at)),
          h("td", { "data-label": "Last sign-in" }, ago(u.last_login_at)),
          h("td", { "data-label": "Country" }, u.country ? `${flag(u.country)} ${u.country}` : "–"),
          h("td", { class: "td-actions" }, h("div", { class: "row-actions" }, actionsFor(u))),
        );
      }),
    );
  };

  const renderStats = (stats) => {
    const set = (id, text) => { $(id).textContent = text; };
    set("s-users", stats.users);
    set("s-signups", `${stats.signups_7d} new in the last 7 days`);
    set("s-trial", stats.trial);
    set("s-pro", stats.pro);
    set("s-revenue", stats.pro === 1 ? "Account with Pro access" : "Accounts with Pro access");
    set("s-expired", stats.expired);
    set("s-inboxes", stats.active_inboxes);
    set("s-emails", `${stats.emails_24h} emails in the last 24h`);
    set("s-blocked", stats.blocked_signups_30d);
  };

  const load = async () => {
    const data = await api("/admin/overview");
    state.now = data.now;
    state.users = data.users;
    renderStats(data.stats);
    render();
  };

  // ---------- Events ----------
  $("filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    $("filters").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    render();
  });
  $("search").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
  });
  $("logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    location.replace("/login/");
  });

  // ---------- Boot ----------
  (async () => {
    try {
      const session = await api("/session");
      if (session.user.role !== "admin") {
        location.replace("/app/");
        return;
      }
      $("nav-account").textContent = session.user.email;
      $("shell").hidden = false;
      await load();
      setInterval(() => load().catch(() => {}), 30_000);
    } catch (error) {
      if (error.message !== "Signed out") toast(error.message);
    }
  })();
})();
