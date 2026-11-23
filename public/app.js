(() => {
  "use strict";

  const POLL_MS = 5000;
  const NAME_RE = /^[a-z0-9.-]{3,30}$/;

  // ---------- Icons (static, trusted markup) ----------
  const svg = (paths) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICONS = {
    copy: svg('<rect x="9" y="9" width="12" height="12" rx="3"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>'),
    back: svg('<path d="M15 18l-6-6 6-6"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>'),
    inbox: svg('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>'),
    open: svg('<path d="M3 10.5 12 4l9 6.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m3 10.5 9 6 9-6"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  };

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);

  const icon = (name) => {
    const el = document.createElement("span");
    el.className = "i";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = ICONS[name];
    return el;
  };

  /** Builds elements with text nodes only: untrusted strings are never parsed as HTML. */
  const h = (tag, attrs, ...children) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  };

  const iconButton = (name, label, onclick, extra = "") =>
    h("button", { class: `icon-btn ${extra}`.trim(), type: "button", "aria-label": label, title: label, onclick }, icon(name));

  document.querySelectorAll("[data-icon]").forEach((el) => el.prepend(icon(el.dataset.icon)));

  // ---------- State ----------
  const state = {
    domain: "",
    ttlMs: 24 * 3600 * 1000,
    skewMs: 0,
    inboxes: [],
    selected: null,
    messages: [],
    messagesLoaded: false,
    knownIds: null,
    unread: new Set(),
    fresh: new Set(),
    openId: null,
    message: null,
    bodyMode: "html",
    loadImages: false,
    pollTimer: null,
    polling: false,
    pollError: false,
    signedIn: false,
    account: null,
    inboxSignature: "",
    messageSignature: "",
  };

  const serverNow = () => Date.now() + state.skewMs;
  const syncClock = (now) => { if (typeof now === "number") state.skewMs = now - Date.now(); };

  // ---------- API ----------
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  const api = async (path, { method = "GET", body } = {}) => {
    let response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch {
      throw new ApiError("Network error. Check your connection.", 0);
    }
    const data = await response.json().catch(() => null);
    if (response.status === 401 && path !== "/login") {
      showLogin();
      throw new ApiError("Signed out", 401);
    }
    if (!response.ok) throw new ApiError(data?.error || `Request failed (${response.status})`, response.status);
    return data;
  };

  // ---------- Formatting ----------
  const pad = (n) => String(n).padStart(2, "0");

  const formatRemaining = (ms) => {
    if (ms <= 0) return "Expired";
    const s = Math.floor(ms / 1000);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    return hours > 0 ? `${hours}h ${pad(minutes)}m left` : `${minutes}m ${pad(s % 60)}s left`;
  };

  const formatAgo = (ts) => {
    const diff = Math.max(0, serverNow() - ts);
    if (diff < 45_000) return "just now";
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  const formatDate = (ts) =>
    new Date(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  const codeGroups = (code) => {
    if (code.length === 6) return [code.slice(0, 3), code.slice(3)];
    if (code.length === 8) return [code.slice(0, 4), code.slice(4)];
    return [code];
  };

  const avatarClass = (address) => {
    let hash = 0;
    for (const ch of address) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return `avatar a${hash % 3}`;
  };

  const collapse = (text) => (text || "").replace(/\s+/g, " ").trim();

  // ---------- Feedback ----------
  let toastTimer;
  const toast = (text, iconName = "check") => {
    const el = $("toast");
    el.replaceChildren(icon(iconName), h("span", {}, text));
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
  };

  const copyText = async (text, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = h("textarea", { style: "position:fixed;opacity:0", readonly: true });
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    toast(label);
  };

  // ---------- Screens ----------
  const showLogin = () => {
    state.signedIn = false;
    stopPolling();
    location.replace(`/login/?next=${encodeURIComponent("/app/")}`);
  };

  const showApp = () => {
    state.signedIn = true;
    $("shell").hidden = false;
    document.title = "Burnbox";
    $("nav-domain").textContent = `@${state.domain}`;
    $("nav-account").textContent = state.account.user.email;
    $("nav-admin").hidden = state.account.user.role !== "admin";
    renderPlan();
    $("domain-suffix").textContent = `@${state.domain}`;
    updateGenerateLabel();
    startPolling();
  };

  const setView = (view) => {
    const layout = $("layout");
    if (layout.dataset.view === view) return;
    layout.dataset.view = view;
    if (window.matchMedia("(max-width: 760px)").matches) window.scrollTo({ top: 0 });
  };

  // ---------- Plan ----------
  const DAY_MS = 24 * 3600 * 1000;

  const daysLeft = (until) => {
    const ms = until - serverNow();
    if (ms <= 0) return "ended";
    if (ms < DAY_MS) return `${Math.max(1, Math.ceil(ms / 3_600_000))}h left`;
    const days = Math.ceil(ms / DAY_MS);
    return `${days} day${days === 1 ? "" : "s"} left`;
  };

  const renderPlan = () => {
    const account = state.account;
    if (!account) return;
    const used = state.inboxes.length;
    const limit = account.inbox_limit;
    const plan = account.plan;

    $("plan-box").hidden = plan === "expired";
    $("locked").hidden = plan !== "expired";
    $("create-form").hidden = plan === "expired";

    const names = { trial: "Free trial", pro: "Pro", admin: "Admin" };
    $("plan-name").textContent = names[plan] || "";
    $("plan-left").textContent = plan === "trial" ? daysLeft(account.trial_ends_at) : plan === "pro" ? `Until ${new Date(account.pro_until).toLocaleDateString()}` : "";
    $("plan-usage").textContent = limit == null ? `${used} active · unlimited` : `${used} of ${limit} inboxes in use`;
    $("plan-meter").hidden = limit == null;
    $("plan-meter-fill").style.width = limit ? `${Math.min(100, (used / limit) * 100)}%` : "0";
    $("plan-meter").classList.toggle("full", limit != null && used >= limit);
    $("plan-upgrade").hidden = plan !== "trial";
    $("plan-box").dataset.plan = plan;
  };

  const openUpgrade = () => {
    const account = state.account;
    if (account?.price) {
      $("upgrade-price").textContent = `${account.price.symbol}${account.price.amount}`;
      if (account.price.yearly) $("upgrade-price-yearly").textContent = `${account.price.symbol}${account.price.yearly}`;
    }
    const contact = $("upgrade-contact");
    if (account?.support_email) {
      contact.hidden = false;
      contact.href = `mailto:${account.support_email}?subject=${encodeURIComponent("Upgrade to Burnbox Pro")}&body=${encodeURIComponent(`Please upgrade ${account.user.email} to Pro.\n\nI'd like to pay: monthly / yearly`)}`;
    } else {
      contact.hidden = true;
    }
    $("upgrade-dialog").showModal();
  };

  // ---------- Inboxes ----------
  const loadInboxes = async () => {
    const data = await api("/inboxes");
    syncClock(data.now);
    state.inboxes = data.inboxes;
    renderPlan();
    if (state.selected && !state.inboxes.some((i) => i.address === state.selected)) {
      toast("That inbox expired or was deleted", "inbox");
      clearSelection();
    }
    renderInboxes();
  };

  const renderInboxes = () => {
    const signature = JSON.stringify([state.selected, state.inboxes.map((i) => [i.address, i.message_count])]);
    $("inbox-count").textContent = String(state.inboxes.length);
    $("inbox-empty").hidden = state.inboxes.length > 0;
    if (signature === state.inboxSignature) return;
    state.inboxSignature = signature;

    $("inbox-list").replaceChildren(
      ...state.inboxes.map((inbox) => {
        const count = inbox.message_count;
        return h(
          "li",
          { class: `inbox${inbox.address === state.selected ? " selected" : ""}` },
          h("button", {
            class: "hit",
            type: "button",
            "aria-label": `Open ${inbox.address}`,
            "aria-current": inbox.address === state.selected ? "true" : null,
            onclick: () => selectInbox(inbox.address),
          }),
          h("span", { class: avatarClass(inbox.address), "aria-hidden": "true" }, inbox.address[0]),
          h(
            "div",
            { class: "inbox-main" },
            h("div", { class: "inbox-addr" }, inbox.address),
            h(
              "div",
              { class: "inbox-meta" },
              h("span", { class: `badge${count ? "" : " zero"}` }, count === 1 ? "1 email" : `${count} emails`),
              h("span", { dataset: { expires: inbox.expires_at } }, formatRemaining(inbox.expires_at - serverNow())),
            ),
            h("div", { class: "progress" }, h("span", { dataset: { progress: inbox.expires_at } })),
          ),
          h(
            "div",
            { class: "actions" },
            iconButton("copy", `Copy ${inbox.address}`, () => copyText(inbox.address, "Address copied"), "sm"),
            iconButton("trash", `Delete ${inbox.address}`, () => deleteInbox(inbox.address), "sm danger"),
          ),
        );
      }),
    );
    tick();
  };

  const updateGenerateLabel = () => {
    const name = $("name-input").value.trim();
    $("generate-btn").textContent = name ? `Create ${name}@${state.domain}` : "Generate address";
  };

  const validateNameInput = () => {
    const name = $("name-input").value.trim();
    let error = "";
    if (name) {
      if (!/^[a-z0-9.-]*$/.test(name)) error = "Only lowercase letters, numbers, dots and hyphens.";
      else if (name.length < 3) error = "At least 3 characters.";
      else if (!NAME_RE.test(name) || /^[.-]|[.-]$/.test(name) || name.includes("..")) error = "Can't start or end with a dot or hyphen, or contain “..”.";
    }
    $("name-hint").textContent = error || "3 to 30 characters: a–z, 0–9, dots and hyphens.";
    $("name-hint").classList.toggle("error", Boolean(error));
    $("name-input").parentElement.classList.toggle("invalid", Boolean(error));
    return !error;
  };

  const createInbox = async (event) => {
    event.preventDefault();
    if (!validateNameInput()) return $("name-input").focus();
    const button = $("generate-btn");
    const name = $("name-input").value.trim();
    button.disabled = true;
    try {
      const { inbox } = await api("/inboxes", { method: "POST", body: name ? { name } : {} });
      $("name-input").value = "";
      updateGenerateLabel();
      state.inboxes = [{ ...inbox, message_count: 0 }, ...state.inboxes.filter((i) => i.address !== inbox.address)];
      renderPlan();
      selectInbox(inbox.address);
      copyText(inbox.address, `${inbox.address} created & copied`);
    } catch (error) {
      if (error.status === 402 || error.status === 403) {
        toast(error.message, "inbox");
        if (error.status === 402 && state.account) state.account.plan = "expired";
        renderPlan();
        openUpgrade();
      } else if (error.status === 400 || error.status === 409) {
        $("name-hint").textContent = error.message;
        $("name-hint").classList.add("error");
        $("name-input").parentElement.classList.add("invalid");
      } else if (error.status !== 401) {
        toast(error.message, "inbox");
      }
    } finally {
      button.disabled = false;
    }
  };

  const deleteInbox = async (address) => {
    if (!confirm(`Delete ${address} and all of its emails now?`)) return;
    try {
      await api(`/inboxes/${encodeURIComponent(address)}`, { method: "DELETE" });
      state.inboxes = state.inboxes.filter((i) => i.address !== address);
      if (state.selected === address) clearSelection();
      renderInboxes();
      renderPlan();
      toast("Inbox deleted", "trash");
    } catch (error) {
      if (error.status !== 401) toast(error.message, "inbox");
    }
  };

  // ---------- Messages ----------
  const selectInbox = (address) => {
    if (state.selected !== address) {
      state.selected = address;
      state.messages = [];
      state.messagesLoaded = false;
      state.knownIds = null;
      state.unread.clear();
      state.fresh.clear();
      state.messageSignature = "";
      closeMessage();
    }
    setView("messages");
    renderInboxes();
    renderMessages();
    loadMessages().catch(handlePollError);
  };

  const clearSelection = () => {
    state.selected = null;
    state.messages = [];
    state.messagesLoaded = false;
    closeMessage();
    setView("inboxes");
    renderMessages();
  };

  const loadMessages = async () => {
    const address = state.selected;
    if (!address) return;
    let data;
    try {
      data = await api(`/inboxes/${encodeURIComponent(address)}/messages`);
    } catch (error) {
      if (error.status === 404 && state.selected === address) {
        toast("That inbox expired or was deleted", "inbox");
        clearSelection();
        loadInboxes().catch(() => {});
        return;
      }
      throw error;
    }
    if (state.selected !== address) return;
    syncClock(data.now);

    const arrived = state.knownIds ? data.messages.filter((m) => !state.knownIds.has(m.id)) : [];
    state.knownIds = new Set(data.messages.map((m) => m.id));
    state.fresh = new Set(arrived.map((m) => m.id));
    arrived.forEach((m) => state.unread.add(m.id));
    state.messages = data.messages;
    state.messagesLoaded = true;

    const summary = state.inboxes.find((i) => i.address === address);
    if (summary && summary.message_count !== data.messages.length) {
      summary.message_count = data.messages.length;
      renderInboxes();
    }
    if (state.openId && !state.knownIds.has(state.openId)) closeMessage();
    renderMessages();

    if (arrived.length) {
      const newest = arrived[0];
      toast(newest.otp_code ? `New code: ${newest.otp_code}` : `New email: ${newest.subject || "(no subject)"}`, "mail");
    }
  };

  const renderMessages = () => {
    const address = state.selected;
    $("messages-none").hidden = Boolean(address);
    $("messages-view").hidden = !address;
    if (!address) return;

    $("messages-address").textContent = address;
    $("waiting-address").textContent = address;
    const inbox = state.inboxes.find((i) => i.address === address);
    const expiry = $("messages-expiry");
    expiry.dataset.expires = inbox ? inbox.expires_at : "";
    expiry.textContent = inbox ? formatRemaining(inbox.expires_at - serverNow()) : "";

    const isEmpty = state.messagesLoaded && state.messages.length === 0;
    $("messages-empty").hidden = !isEmpty;
    $("message-list").hidden = isEmpty;

    const signature = JSON.stringify([address, state.openId, [...state.unread], state.messages.map((m) => m.id)]);
    if (signature === state.messageSignature) return;
    state.messageSignature = signature;

    $("message-list").replaceChildren(
      ...state.messages.map((m) => {
        const classes = ["msg"];
        if (m.id === state.openId) classes.push("selected");
        if (state.unread.has(m.id)) classes.push("unread");
        if (state.fresh.has(m.id)) classes.push("fresh");
        return h(
          "li",
          { class: classes.join(" ") },
          h("button", {
            class: "hit",
            type: "button",
            "aria-label": `Open email: ${m.subject || "(no subject)"}`,
            onclick: () => openMessage(m.id),
          }),
          h(
            "div",
            { class: "msg-top" },
            h("span", { class: "msg-from" }, m.from_address || "Unknown sender"),
            h("time", { class: "msg-time", dataset: { ago: m.received_at }, datetime: new Date(m.received_at).toISOString() }, formatAgo(m.received_at)),
          ),
          h("div", { class: "msg-subject" }, m.subject || "(no subject)"),
          m.snippet ? h("div", { class: "msg-snippet" }, collapse(m.snippet)) : null,
          m.otp_code
            ? h(
                "div",
                { class: "otp-chip" },
                h("span", {}, m.otp_code),
                iconButton("copy", `Copy code ${m.otp_code}`, (e) => {
                  e.stopPropagation();
                  copyText(m.otp_code, `Code ${m.otp_code} copied`);
                }),
              )
            : null,
        );
      }),
    );
  };

  // ---------- Reader ----------
  const closeMessage = () => {
    state.openId = null;
    state.message = null;
    renderReader();
  };

  const openMessage = async (id) => {
    state.openId = id;
    state.message = null;
    state.unread.delete(id);
    state.loadImages = false;
    setView("message");
    renderMessages();
    renderReader();
    try {
      const { message } = await api(`/messages/${id}`);
      if (state.openId !== id) return;
      state.message = message;
      state.bodyMode = message.html_body ? "html" : "text";
      renderReader();
    } catch (error) {
      if (error.status === 401) return;
      toast(error.message, "inbox");
      if (state.openId === id) closeMessage();
    }
  };

  const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
  const trimUrl = (url) => url.replace(/[)\]}>.,;:!?'"]+$/, "");
  const VERIFY_HINT = /verif|confirm|activat|magic|sign[-_ ]?in|log[-_ ]?in|reset|token|auth|invite|validat|onboard|otp|code/i;
  const NOISE_HINT = /unsubscribe|preferences|privacy|terms|help|support|facebook|twitter|linkedin|instagram|youtube|x\.com/i;

  /** Pulls http(s) links from the email. DOMParser documents are inert: no scripts run, no images load. */
  const extractLinks = (message) => {
    const found = [];
    if (message.html_body) {
      const doc = new DOMParser().parseFromString(message.html_body, "text/html");
      doc.querySelectorAll("a[href]").forEach((a) => {
        const href = (a.getAttribute("href") || "").trim();
        if (/^https?:\/\//i.test(href)) found.push({ href, text: collapse(a.textContent) });
      });
    }
    for (const match of (message.text_body || "").matchAll(URL_RE)) found.push({ href: trimUrl(match[0]), text: "" });

    const byHref = new Map();
    for (const link of found) {
      const existing = byHref.get(link.href);
      if (!existing) byHref.set(link.href, link);
      else if (!existing.text && link.text) existing.text = link.text;
    }
    return [...byHref.values()]
      .map((link, index) => {
        const haystack = `${link.href} ${link.text}`;
        const score = (VERIFY_HINT.test(haystack) ? 2 : 0) - (NOISE_HINT.test(haystack) ? 2 : 0);
        return { ...link, score, index };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 5);
  };

  const REMOTE_CONTENT = /<img\b[^>]*\bsrc(set)?\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\/|\bbackground\s*=\s*["']?\s*(https?:)?\/\//i;

  /**
   * The email renders in an iframe with sandbox="allow-popups allow-popups-to-escape-sandbox":
   * no scripts, no forms, opaque origin (cannot touch this page or its cookies). Links open in
   * a new tab. A CSP inside the frame blocks remote images, CSS and fonts until you opt in.
   */
  const buildSrcdoc = (html, allowRemote) => {
    const csp = allowRemote
      ? "default-src 'none'; img-src https: http: data: cid:; style-src 'unsafe-inline' https:; font-src https: data:; media-src https: data:"
      : "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>html,body{margin:0;background:#fff;color:#111}body{padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`;
  };

  const linkifyInto = (el, text) => {
    let last = 0;
    for (const match of text.matchAll(URL_RE)) {
      const url = trimUrl(match[0]);
      el.append(text.slice(last, match.index));
      el.append(h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, url));
      last = match.index + url.length;
    }
    el.append(text.slice(last));
  };

  const renderReader = () => {
    const reader = $("reader");
    const hasOpen = state.openId != null;
    $("reader-none").hidden = hasOpen;
    reader.hidden = !hasOpen;
    if (!hasOpen) return reader.replaceChildren();

    const back = iconButton("back", "Back to messages", () => { closeMessage(); setView("messages"); renderMessages(); }, "back-messages");
    const m = state.message;
    if (!m) return reader.replaceChildren(h("div", { class: "reader-top" }, back), h("div", { class: "reader-loading" }, "Loading…"));

    const parts = [
      h("div", { class: "reader-top" }, back, h("h2", { class: "reader-subject" }, m.subject || "(no subject)")),
      h(
        "dl",
        { class: "reader-meta" },
        h("dt", {}, "From"), h("dd", {}, m.from_address || "Unknown sender"),
        h("dt", {}, "To"), h("dd", { class: "mono" }, m.address),
        h("dt", {}, "Received"), h("dd", {}, `${formatDate(m.received_at)} · `, h("span", { class: "muted", dataset: { ago: m.received_at } }, formatAgo(m.received_at))),
      ),
    ];

    if (m.otp_code) {
      parts.push(
        h(
          "section",
          { class: "otp-hero", "aria-label": "Detected code" },
          h("div", {}, h("p", { class: "label" }, "Detected code"), h("div", { class: "otp-digits mono" }, codeGroups(m.otp_code).map((g) => h("span", {}, g)))),
          h("button", { class: "btn btn-primary", type: "button", onclick: () => copyText(m.otp_code, `Code ${m.otp_code} copied`) }, icon("copy"), "Copy code"),
        ),
      );
    }

    const links = extractLinks(m);
    if (links.length) {
      parts.push(
        h(
          "section",
          { class: "links", "aria-label": "Links in this email" },
          h("div", { class: "links-title" }, icon("link"), links[0].score > 0 ? "Links (most likely verification link first)" : "Links in this email"),
          links.map((link, i) => {
            let pretty = link.href;
            try { const u = new URL(link.href); pretty = u.host + u.pathname; } catch {}
            return h(
              "div",
              { class: `link-row${i === 0 && link.score > 0 ? " primary" : ""}` },
              h("a", { class: "link-main", href: link.href, target: "_blank", rel: "noopener noreferrer" }, h("span", { class: "link-text" }, link.text || pretty), h("span", { class: "link-url" }, link.href)),
              iconButton("copy", "Copy link", () => copyText(link.href, "Link copied"), "sm"),
              h("a", { class: "icon-btn sm", href: link.href, target: "_blank", rel: "noopener noreferrer", "aria-label": "Open link", title: "Open link" }, icon("external")),
            );
          }),
        ),
      );
    }

    const hasHtml = Boolean(m.html_body);
    const hasRemote = hasHtml && REMOTE_CONTENT.test(m.html_body);
    const modeButton = (mode, label) =>
      h("button", { type: "button", "aria-pressed": String(state.bodyMode === mode), onclick: () => { state.bodyMode = mode; renderReader(); } }, label);

    parts.push(
      h(
        "div",
        { class: "body-bar" },
        hasHtml ? h("div", { class: "segmented", role: "group", "aria-label": "Body format" }, modeButton("html", "HTML"), modeButton("text", "Text")) : null,
        state.bodyMode === "html" && hasRemote
          ? h(
              "span",
              { class: "images-note" },
              icon("image"),
              state.loadImages ? "Remote images loaded" : "Remote images blocked",
              state.loadImages ? null : h("button", { class: "btn btn-ghost", type: "button", onclick: () => { state.loadImages = true; renderReader(); } }, "Load images"),
            )
          : null,
      ),
    );

    if (state.bodyMode === "html" && hasHtml) {
      const frame = h("iframe", {
        class: "body-frame",
        title: "Email content",
        sandbox: "allow-popups allow-popups-to-escape-sandbox",
        referrerpolicy: "no-referrer",
        loading: "lazy",
      });
      frame.srcdoc = buildSrcdoc(m.html_body, state.loadImages);
      parts.push(frame);
    } else {
      const pre = h("pre", { class: "body-text" });
      linkifyInto(pre, m.text_body || "(empty message)");
      parts.push(pre);
    }

    reader.replaceChildren(...parts);
    reader.scrollTop = 0;
  };

  // ---------- Live updates ----------
  const tick = () => {
    const now = serverNow();
    let expired = false;
    document.querySelectorAll("[data-expires]").forEach((el) => {
      const expiresAt = Number(el.dataset.expires);
      if (!expiresAt) return;
      el.textContent = formatRemaining(expiresAt - now);
      if (expiresAt <= now) expired = true;
    });
    document.querySelectorAll("[data-progress]").forEach((el) => {
      const left = Math.max(0, Number(el.dataset.progress) - now);
      el.style.width = `${Math.min(100, (left / state.ttlMs) * 100)}%`;
      el.parentElement.classList.toggle("low", left < 3_600_000);
    });
    document.querySelectorAll("[data-ago]").forEach((el) => { el.textContent = formatAgo(Number(el.dataset.ago)); });
    if (expired && state.signedIn) poll();
  };

  const setLive = () => {
    const live = $("live");
    const paused = document.hidden;
    live.classList.toggle("paused", paused);
    live.classList.toggle("error", !paused && state.pollError);
    $("live-text").textContent = paused ? "Paused" : state.pollError ? "Reconnecting…" : "Live · every 5s";
  };

  const handlePollError = (error) => {
    if (error?.status === 401) return;
    state.pollError = true;
    setLive();
  };

  const poll = async () => {
    if (state.polling || document.hidden || !state.signedIn) return;
    state.polling = true;
    try {
      await loadInboxes();
      if (state.selected) await loadMessages();
      state.pollError = false;
      setLive();
    } catch (error) {
      handlePollError(error);
    } finally {
      state.polling = false;
    }
  };

  const startPolling = () => {
    stopPolling();
    setLive();
    if (document.hidden || !state.signedIn) return;
    poll();
    state.pollTimer = setInterval(poll, POLL_MS);
  };

  const stopPolling = () => {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  };

  document.addEventListener("visibilitychange", () => {
    if (!state.signedIn) return;
    if (document.hidden) { stopPolling(); setLive(); }
    else startPolling();
  });
  setInterval(tick, 1000);

  // ---------- Events ----------
  $("logout-btn").addEventListener("click", async () => {
    stopPolling();
    await api("/logout", { method: "POST" }).catch(() => {});
    location.replace("/login/");
  });

  $("plan-upgrade").addEventListener("click", openUpgrade);
  $("locked-upgrade").addEventListener("click", openUpgrade);

  $("create-form").addEventListener("submit", createInbox);
  $("name-input").addEventListener("input", (event) => {
    const input = event.target;
    const lowered = input.value.toLowerCase().replace(/\s+/g, "");
    if (lowered !== input.value) input.value = lowered;
    updateGenerateLabel();
    validateNameInput();
  });

  $("back-inboxes").addEventListener("click", () => setView("inboxes"));
  $("copy-address").addEventListener("click", () => state.selected && copyText(state.selected, "Address copied"));
  $("waiting-copy").addEventListener("click", () => state.selected && copyText(state.selected, "Address copied"));
  $("delete-current").addEventListener("click", () => state.selected && deleteInbox(state.selected));
  $("refresh-btn").addEventListener("click", () => poll());

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.signedIn || event.target.closest("input")) return;
    const view = $("layout").dataset.view;
    if (view === "message") { closeMessage(); setView("messages"); renderMessages(); }
    else if (view === "messages") setView("inboxes");
  });

  // ---------- Boot ----------
  const boot = async () => {
    try {
      const session = await api("/session");
      state.account = session;
      state.domain = session.domain;
      state.ttlMs = session.ttl_ms;
      syncClock(session.now);
      showApp();
    } catch (error) {
      if (error.status !== 401) {
        toast(`${error.message} Retrying…`, "inbox");
        setTimeout(boot, 5000);
      }
    }
  };

  boot();
})();
