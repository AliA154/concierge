/* Concierge front end.
 *
 * Single-file, zero-dependency ES2020. Everything renders from one
 * module-level `state` object through renderQueue()/renderMetrics() —
 * filters, polling, FLIP reorder, and keyboard selection all converge on
 * that single render path. A 1-second tick loop keeps the SLA clocks live
 * between 15-second polls by touching text nodes only.
 *
 * Sections: helpers / state / api / render / tick / drawer / form /
 *           shortcuts / toasts / boot
 */
"use strict";

/* ============================================================ helpers == */

const $ = (sel) => document.querySelector(sel);

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
const reduceMotion = () => REDUCED_MOTION.matches;

// Escape ALL user strings before HTML interpolation (textContent-based,
// plus quote entities so escaped values are safe inside attributes too).
const escapeNode = document.createElement("span");
function escapeHtml(value) {
  escapeNode.textContent = value == null ? "" : String(value);
  return escapeNode.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Server-adjusted wall clock (§7.3): every time-derived value uses this.
const now = () => Date.now() + state.clockOffsetMs;

// `MM:SS` from fractional minutes, floored at zero (callers negate for
// breach overshoot).
function fmtClock(minutes) {
  const totalSec = Math.max(0, Math.round(minutes * 60));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function fmtAge(iso, nowMs) {
  const mins = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function fmtRelative(iso, nowMs) {
  const mins = Math.floor((nowMs - Date.parse(iso)) / 60000);
  return mins < 1 ? "just now" : `${fmtAge(iso, nowMs)} ago`;
}

function fmtDeskTime(nowMs) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/* ============================================================== state == */

const AGENT_STORAGE_KEY = "concierge.actingAgent";

function storedAgent() {
  try { return localStorage.getItem(AGENT_STORAGE_KEY) || ""; } catch { return ""; }
}

const state = {
  tickets: new Map(),      // id -> Ticket (server shape, §4.1)
  queueIds: [],            // open tickets, server sort order (§2.9)
  resolvedIds: [],         // Resolved/Closed, newest resolution first
  metrics: {},
  meta: null,              // /api/meta payload — matrix, transitions, agents
  clockOffsetMs: 0,        // server `now` minus client Date.now()
  actingAgent: storedAgent(),
  filter: "all",           // all | vip | at_risk | unassigned
  search: "",
  selectedId: null,        // keyboard selection, keyed by id (survives reorder)
  drawerId: null,
  titleBreachCount: 0,
  loaded: false,           // first successful /api/tickets landed
};

const OPEN_STATES = ["New", "In Progress", "On Hold"];
const isOpen = (t) => OPEN_STATES.includes(t.state);

// Hover quick action per state (§6.3): one next-state button.
const QUICK_ACTION = {
  "New":         { label: "Start",   state: "In Progress" },
  "In Progress": { label: "Resolve", state: "Resolved" },
  "On Hold":     { label: "Resume",  state: "In Progress" },
};

function agentByName(name) {
  return state.meta?.agents.find((a) => a.name === name) || null;
}

function priorityRank(priority) {
  // Rank from meta order (Critical=0 … Low=3); domain data stays server-owned.
  const idx = state.meta ? state.meta.priorities.indexOf(priority) : -1;
  return idx === -1 ? 99 : idx;
}

// Live SLA math (§2.4/§2.5) — the client-side mirror of the backend ramp,
// evaluated every second so clocks never freeze between polls.
function liveSla(t, nowMs) {
  if (!isOpen(t)) {
    return { elapsedMin: t.sla_elapsed_min, remainingMin: null, status: t.sla_status };
  }
  let elapsedMin = (nowMs - Date.parse(t.created_at)) / 60000 - t.held_minutes;
  if (t.on_hold_since) elapsedMin -= (nowMs - Date.parse(t.on_hold_since)) / 60000;
  const remainingMin = t.sla_target_min - elapsedMin;
  let status;
  if (elapsedMin > t.sla_target_min) status = "breached"; // sticky, even On Hold
  else if (t.state === "On Hold") status = "paused";
  else if (elapsedMin / t.sla_target_min >= 0.75) status = "at_risk";
  else status = "ok";
  return { elapsedMin, remainingMin, status };
}

// §2.9 queue sort, used only to place optimistic inserts until the next
// poll restores the server's authoritative order.
function queueSortKey(t) {
  return [t.is_vip ? 0 : 1, priorityRank(t.priority), t.created_at];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// Put a ticket in the right membership list after a local mutation.
function syncMembership(t) {
  state.queueIds = state.queueIds.filter((id) => id !== t.id);
  state.resolvedIds = state.resolvedIds.filter((id) => id !== t.id);
  if (isOpen(t)) {
    const key = queueSortKey(t);
    const idx = state.queueIds.findIndex(
      (id) => compareKeys(key, queueSortKey(state.tickets.get(id))) < 0
    );
    if (idx === -1) state.queueIds.push(t.id);
    else state.queueIds.splice(idx, 0, t.id);
  } else {
    state.resolvedIds.unshift(t.id); // newest resolution first
  }
}

function applyTicket(t) {
  const prev = state.tickets.get(t.id);
  t._lastLiveStatus = prev?._lastLiveStatus ?? liveSla(t, now()).status;
  state.tickets.set(t.id, t);
  syncMembership(t);
}

function setActingAgent(name) {
  state.actingAgent = name;
  try { localStorage.setItem(AGENT_STORAGE_KEY, name); } catch { /* private mode */ }
  const agent = agentByName(name);
  const chip = $("#agentChip");
  chip.textContent = agent ? agent.initials : "?";
  chip.style.background = agent ? agent.color : "";
}

/* ================================================================ api == */

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    // Cosmetic actor attribution (§2.10) — the server falls back to "System"
    // for unknown values, so this is never a failure mode.
    headers["X-Agent"] = state.actingAgent;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Request failed (${res.status})`);
  }
  return data;
}

async function loadMeta() {
  try {
    state.meta = await api("/api/meta");
    populateForm();
    populateAgentPicker();
  } catch {
    setTimeout(loadMeta, 3000); // retry quietly; nothing renders without meta
  }
}

async function fetchTickets() {
  try {
    const data = await api("/api/tickets");
    state.clockOffsetMs = Date.parse(data.now) - Date.now();
    const fresh = new Map();
    for (const t of [...data.queue, ...data.resolved]) {
      const prev = state.tickets.get(t.id);
      // Carry breach-crossing memory across polls so already-breached
      // tickets don't re-toast on every refresh.
      t._lastLiveStatus = prev?._lastLiveStatus ?? liveSla(t, now()).status;
      fresh.set(t.id, t);
    }
    state.tickets = fresh;
    state.queueIds = data.queue.map((t) => t.id);
    state.resolvedIds = data.resolved.map((t) => t.id);
    state.metrics = data.metrics;
    state.loaded = true;
    $("#reconnectPill").hidden = true;
    renderAll();
    refreshDrawer(); // drawer refreshes by id; never clobbers the note draft
  } catch {
    // Keep the last known state on screen; just admit we're offline.
    $("#reconnectPill").hidden = false;
  }
}

// Mutations poll immediately after reconciling (§7.2).
const refresh = fetchTickets;

/* ============================================================== render == */

const queueEl = $("#queue");
const resolvedListEl = $("#resolvedList");
const queuePanelEl = $("#queuePanel");

const LOCK_SVG =
  '<svg class="lock" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
  '<rect x="2" y="5" width="8" height="6" rx="1" fill="currentColor"/>' +
  '<path d="M4 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

function renderAll() {
  if (!state.loaded || !state.meta) return;
  document.body.classList.remove("shimmer-on");
  renderMetrics();
  renderQueue();
  renderVipBanner();
  updateTitle();
}

function visibleQueueIds() {
  const nowMs = now();
  const q = state.search.trim().toLowerCase();
  return state.queueIds.filter((id) => {
    const t = state.tickets.get(id);
    if (state.filter === "vip" && !t.is_vip) return false;
    if (state.filter === "unassigned" && t.assigned_to) return false;
    if (state.filter === "at_risk") {
      // Breached tickets stay in "At risk" — a manager filtering for trouble
      // must not lose a ticket the moment it tips over.
      const s = liveSla(t, nowMs).status;
      if (s !== "at_risk" && s !== "breached") return false;
    }
    return !q || matchesSearch(t, q);
  });
}

function matchesSearch(t, q) {
  return (
    t.subject.toLowerCase().includes(q) ||
    t.requester.toLowerCase().includes(q) ||
    t.number.toLowerCase().includes(q)
  );
}

function assigneeChipHtml(t) {
  const agent = agentByName(t.assigned_to);
  if (agent) {
    return `<span class="avatar" style="background:${escapeHtml(agent.color)}" title="${escapeHtml(agent.name)}">${escapeHtml(agent.initials)}</span>`;
  }
  return '<span class="avatar unassigned" title="Unassigned">&middot;</span>';
}

function rowHtml(t, nowMs) {
  const quick = QUICK_ACTION[t.state];
  const glyphTitle = `${t.priority} — Impact ${t.impact} / Urgency ${t.urgency}`;
  return `<div class="row ${t.is_vip ? "is-vip" : ""} ${!t.is_vip && t.priority === "Critical" ? "is-crit" : ""}" data-id="${t.id}">
    <span class="cell number num">${t.number}</span>
    <span class="cell glyph"><i class="pglyph p-${t.priority.toLowerCase()}" title="${escapeHtml(glyphTitle)}"></i></span>
    <span class="cell subject">
      <span class="subject-text" title="${escapeHtml(t.subject)}">${escapeHtml(t.subject)}</span>
      <span class="requester">${escapeHtml(t.requester)}</span>
      ${t.reopened_count > 0 ? `<span class="tag-reopened">Reopened &times;${t.reopened_count}</span>` : ""}
      <span class="row-actions">
        ${!t.assigned_to ? '<button type="button" class="ghost" data-action="take">Take</button>' : ""}
        ${quick ? `<button type="button" class="ghost" data-action="state" data-state="${quick.state}">${quick.label}</button>` : ""}
      </span>
    </span>
    <span class="cell"><span class="type-tag">${t.ticket_type}</span></span>
    <span class="cell assignee">${assigneeChipHtml(t)}</span>
    <span class="cell vip">${t.is_vip ? '<span class="vip-star" title="VIP — SLA target halved">&#9733;</span>' : ""}</span>
    <span class="cell age num">${fmtAge(t.created_at, nowMs)}</span>
    <span class="cell sla"><span class="clock num"></span><span class="bar"><i></i></span></span>
  </div>`;
}

function doneRowHtml(t, nowMs) {
  const mins = Math.round(t.sla_elapsed_min);
  const lock = t.state === "Closed" ? LOCK_SVG : "";
  const chip = t.sla_status === "met"
    ? `<span class="outcome met">${lock}Met in ${mins}m</span>`
    : `<span class="outcome missed">${lock}Missed &middot; ${mins}m</span>`;
  return `<div class="row done ${t.is_vip ? "is-vip" : ""}" data-id="${t.id}">
    <span class="cell number num">${t.number}</span>
    <span class="cell glyph"><i class="pglyph p-${t.priority.toLowerCase()}" title="${escapeHtml(t.priority)}"></i></span>
    <span class="cell subject">
      <span class="subject-text" title="${escapeHtml(t.subject)}">${escapeHtml(t.subject)}</span>
      <span class="requester">${escapeHtml(t.requester)}</span>
      ${t.reopened_count > 0 ? `<span class="tag-reopened">Reopened &times;${t.reopened_count}</span>` : ""}
    </span>
    <span class="cell"><span class="type-tag">${t.ticket_type}</span></span>
    <span class="cell assignee">${assigneeChipHtml(t)}</span>
    <span class="cell vip">${t.is_vip ? '<span class="vip-star">&#9733;</span>' : ""}</span>
    <span class="cell age num">${fmtAge(t.created_at, nowMs)}</span>
    <span class="cell sla">${chip}</span>
  </div>`;
}

// One row's SLA instrument + ramp classes. Called at render time and by the
// 1s tick — the single source of truth for the color ramp (§6.4).
function updateRowSla(row, t, sla) {
  row.classList.toggle("sla-breached", sla.status === "breached");
  row.classList.toggle("sla-paused", sla.status === "paused");
  row.classList.toggle("sla-at-risk", sla.status === "at_risk");
  const clock = row.querySelector(".clock");
  const bar = row.querySelector(".bar i");
  if (!clock || !bar) return; // row replaced mid-tick — next tick catches up
  if (sla.status === "breached") {
    clock.textContent = `BREACHED +${fmtClock(-sla.remainingMin)}`;
    bar.style.width = "100%"; // solid crit bar
  } else if (sla.status === "paused") {
    clock.textContent = `Paused · ${Math.round(sla.elapsedMin)}m used of ${t.sla_target_min}m`;
    bar.style.width = `${clamp01(sla.remainingMin / t.sla_target_min) * 100}%`;
  } else {
    clock.textContent = fmtClock(sla.remainingMin);
    bar.style.width = `${clamp01(sla.remainingMin / t.sla_target_min) * 100}%`;
  }
}

function renderQueue() {
  if (!state.loaded || !state.meta) return;
  const nowMs = now();
  const ids = visibleQueueIds();

  // FLIP first phase: remember where every row currently sits (§7.4).
  const before = new Map();
  if (!reduceMotion()) {
    for (const el of queuePanelEl.querySelectorAll(".row[data-id]")) {
      before.set(el.dataset.id, el.getBoundingClientRect().top);
    }
  }

  queueEl.innerHTML = ids.map((id) => rowHtml(state.tickets.get(id), nowMs)).join("");
  for (const el of queueEl.children) {
    const t = state.tickets.get(Number(el.dataset.id));
    updateRowSla(el, t, liveSla(t, nowMs));
  }

  $("#queueEmpty").hidden = state.queueIds.length !== 0;
  $("#queueNoMatch").hidden = !(state.queueIds.length > 0 && ids.length === 0);

  // Resolved section: search applies, category filters are queue concepts.
  const q = state.search.trim().toLowerCase();
  const doneIds = state.resolvedIds.filter((id) => !q || matchesSearch(state.tickets.get(id), q));
  resolvedListEl.innerHTML = doneIds.map((id) => doneRowHtml(state.tickets.get(id), nowMs)).join("");
  $("#resolvedSection").hidden = doneIds.length === 0;
  $("#resolvedCount").textContent = String(state.resolvedIds.length);

  updateFilterCounts(nowMs);
  applySelection();

  // FLIP second phase: play inverted transforms back to identity.
  if (!reduceMotion()) playFlip(before);
}

function playFlip(before) {
  const firstPaint = before.size === 0;
  for (const el of queuePanelEl.querySelectorAll(".row[data-id]")) {
    const prevTop = before.get(el.dataset.id);
    if (prevTop === undefined) {
      if (!firstPaint) el.classList.add("row-enter");
      continue;
    }
    const delta = prevTop - el.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    el.style.transform = `translateY(${delta}px)`;
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = "transform 250ms ease";
      el.style.transform = "";
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    });
  }
}

function updateFilterCounts(nowMs) {
  const open = state.queueIds.map((id) => state.tickets.get(id));
  const counts = {
    all: open.length,
    vip: open.filter((t) => t.is_vip).length,
    at_risk: open.filter((t) => ["at_risk", "breached"].includes(liveSla(t, nowMs).status)).length,
    unassigned: open.filter((t) => !t.assigned_to).length,
  };
  for (const [key, value] of Object.entries(counts)) {
    const el = document.querySelector(`[data-count="${key}"]`);
    if (el) el.textContent = String(value);
  }
}

function applySelection() {
  for (const el of queueEl.querySelectorAll(".row[data-id]")) {
    el.classList.toggle("selected", Number(el.dataset.id) === state.selectedId);
  }
}

function shakeRow(id) {
  const row = queueEl.querySelector(`[data-id="${id}"]`);
  if (!row) return;
  row.classList.add("shake");
  row.addEventListener("animationend", () => row.classList.remove("shake"), { once: true });
}

/* ---- metrics tiles (§6.5) ---- */

const DONUT_R = 10;
const DONUT_C = 2 * Math.PI * DONUT_R;
let metricsBuilt = false;

function buildMetricTiles() {
  $("#metrics").innerHTML = [
    tileHtml("open", "Open"),
    tileHtml("unassigned", "Unassigned"),
    tileHtml("at_risk", "At risk"),
    tileHtml("breaching", "Breaching", '<span class="pulse-dot" hidden></span>'),
    tileHtml("sla_met", "SLA met",
      `<svg class="donut" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle class="donut-bg" cx="12" cy="12" r="${DONUT_R}"/>
        <circle class="donut-fg" cx="12" cy="12" r="${DONUT_R}" stroke-dasharray="0 ${DONUT_C}"/>
      </svg>`),
    tileHtml("mttr", "MTTR"),
  ].join("");
  metricsBuilt = true;
}

function tileHtml(name, label, extra = "") {
  return `<div class="tile" data-tile="${name}">
    <div class="tile-label">${label}</div>
    <div class="tile-valuerow"><span class="tile-value num" data-value></span>${extra}</div>
    <div class="tile-context" data-context></div>
  </div>`;
}

// 300ms count-up tween between polled values; instant under reduced motion.
function setTileValue(name, value, fmt) {
  const el = document.querySelector(`[data-tile="${name}"] [data-value]`);
  const prev = parseFloat(el.dataset.raw ?? "NaN");
  el.dataset.raw = String(value);
  if (reduceMotion() || !Number.isFinite(prev) || prev === value) {
    el.textContent = fmt(value);
    return;
  }
  const started = performance.now();
  const token = Symbol();
  el._tween = token;
  const step = (ts) => {
    if (el._tween !== token) return; // superseded by a newer tween
    const p = Math.min(1, (ts - started) / 300);
    const eased = 1 - (1 - p) * (1 - p);
    el.textContent = fmt(prev + (value - prev) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setTileContext(name, text) {
  document.querySelector(`[data-tile="${name}"] [data-context]`).textContent = text;
}

function renderMetrics() {
  const m = state.metrics;
  if (m.open === undefined) return;
  if (!metricsBuilt) buildMetricTiles();
  const int = (v) => String(Math.round(v));

  setTileValue("open", m.open, int);
  setTileContext("open", `${m.vip_open} VIP`);

  setTileValue("unassigned", m.unassigned, int);
  setTileContext("unassigned", `of ${m.open} open`);
  document.querySelector('[data-tile="unassigned"]').classList.toggle("warn", m.unassigned > 0);

  setTileValue("at_risk", m.at_risk, int);
  setTileContext("at_risk", "≥75% SLA used");
  document.querySelector('[data-tile="at_risk"]').classList.toggle("warn", m.at_risk > 0);

  setTileValue("breaching", m.breaching, int);
  setTileContext("breaching", m.breaching > 0 ? "needs eyes now" : "none breaching");
  const breachTile = document.querySelector('[data-tile="breaching"]');
  breachTile.classList.toggle("alert", m.breaching > 0);
  breachTile.querySelector(".pulse-dot").hidden = m.breaching === 0;

  setTileValue("sla_met", m.sla_met_pct, (v) => `${Math.round(v)}%`);
  setTileContext("sla_met", "target ≥ 90%");
  const donutFg = document.querySelector('[data-tile="sla_met"] .donut-fg');
  donutFg.setAttribute("stroke-dasharray", `${(m.sla_met_pct / 100) * DONUT_C} ${DONUT_C}`);
  donutFg.style.stroke =
    m.sla_met_pct >= 90 ? "var(--ok)" : m.sla_met_pct >= 75 ? "var(--warn)" : "var(--crit)";

  setTileValue("mttr", m.mttr_min, (v) => `${v.toFixed(1)}m`);
  setTileContext("mttr", `${m.resolved} resolved`);
}

/* ---- VIP breach banner (§6.5) ---- */

function renderVipBanner() {
  const nowMs = now();
  const banner = $("#vipBanner");
  const breachedVip = state.queueIds
    .map((id) => state.tickets.get(id))
    .find((t) => t.is_vip && liveSla(t, nowMs).status === "breached");
  if (!breachedVip) {
    banner.hidden = true;
    return;
  }
  banner.innerHTML = `&#9733; VIP ticket <span class="num">${breachedVip.number}</span> has breached SLA`;
  banner.dataset.id = String(breachedVip.id);
  banner.hidden = false;
}

function updateTitle() {
  const nowMs = now();
  const count = state.queueIds
    .map((id) => state.tickets.get(id))
    .filter((t) => liveSla(t, nowMs).status === "breached").length;
  if (count !== state.titleBreachCount) {
    state.titleBreachCount = count;
    document.title = count > 0 ? `(${count}⚠) Concierge` : "Concierge";
  }
}

/* ---- optimistic mutations (§7.4) ---- */

// Local mirror of the backend transition side effects (§2.4/§2.6/§2.7/§2.10)
// so the UI is truthful in the gap before the PATCH response reconciles it.
function applyLocalTransition(t, nextState) {
  const nowMs = now();
  const iso = new Date(nowMs).toISOString();
  if (t.on_hold_since) { // leaving hold accrues first (§2.4)
    t.held_minutes += (nowMs - Date.parse(t.on_hold_since)) / 60000;
    t.on_hold_since = null;
  }
  if (nextState === "On Hold") t.on_hold_since = iso;
  if (nextState === "Resolved") {
    const elapsed = (nowMs - Date.parse(t.created_at)) / 60000 - t.held_minutes;
    t.resolved_at = iso;
    t.sla_elapsed_min = Math.round(elapsed * 10) / 10;
    t.sla_remaining_min = null;
    if (t.sla_met === null) t.sla_met = elapsed <= t.sla_target_min; // frozen (§2.6)
    t.sla_status = t.sla_met ? "met" : "missed";
  }
  if (nextState === "Closed") t.closed_at = iso;
  if (nextState === "In Progress" && !t.assigned_to && agentByName(state.actingAgent)) {
    t.assigned_to = state.actingAgent; // auto-assign mirror (§2.10)
  }
  t.state = nextState;
}

function snapshot() {
  return {
    ticket: null, // set by caller
    queueIds: [...state.queueIds],
    resolvedIds: [...state.resolvedIds],
  };
}

function revert(snap) {
  state.tickets.set(snap.ticket.id, snap.ticket);
  state.queueIds = snap.queueIds;
  state.resolvedIds = snap.resolvedIds;
  renderQueue();
  if (state.drawerId === snap.ticket.id) renderDrawerTicket(snap.ticket);
}

async function changeState(id, nextState) {
  const t = state.tickets.get(id);
  if (!t || !state.meta.transitions[t.state]?.includes(nextState)) {
    shakeRow(id);
    return;
  }
  const snap = snapshot();
  snap.ticket = { ...t };

  applyLocalTransition(t, nextState);
  syncMembership(t);
  renderQueue();
  if (state.drawerId === id) renderDrawerTicket(t);

  let undoToast = null;
  if (nextState === "Resolved") {
    // Undo is honestly a reopen: it increments reopened_count and leaves the
    // frozen SLA outcome untouched — exactly what the endpoint is for.
    undoToast = toast(`${t.number} resolved`, {
      type: "ok",
      action: "Undo",
      onAction: () => reopenTicket(id),
      duration: 6000,
    });
  }

  try {
    const updated = await api(`/api/tickets/${id}`, { method: "PATCH", body: { state: nextState } });
    applyTicket(updated);
    renderQueue();
    if (state.drawerId === id) renderDrawerTicket(updated);
    refresh();
  } catch (err) {
    if (undoToast) undoToast.dismiss();
    revert(snap);
    toast(err.message, { type: "error" });
  }
}

// Resolve from a visible row: collapse it (200ms), then run the transition.
function resolveFromRow(id) {
  const row = queueEl.querySelector(`[data-id="${id}"]`);
  if (row && !reduceMotion()) {
    row.classList.add("collapsing");
    setTimeout(() => changeState(id, "Resolved"), 200);
  } else {
    changeState(id, "Resolved");
  }
}

async function assignTicket(id, name) {
  const t = state.tickets.get(id);
  if (!t || t.assigned_to === name) return;
  const snap = snapshot();
  snap.ticket = { ...t };
  t.assigned_to = name;
  renderQueue();
  if (state.drawerId === id) renderDrawerTicket(t);
  try {
    const updated = await api(`/api/tickets/${id}`, { method: "PATCH", body: { assigned_to: name } });
    applyTicket(updated);
    renderQueue();
    if (state.drawerId === id) renderDrawerTicket(updated);
    refresh();
  } catch (err) {
    revert(snap);
    toast(err.message, { type: "error" });
  }
}

async function reopenTicket(id) {
  try {
    const updated = await api(`/api/tickets/${id}/reopen`, { method: "POST" });
    applyTicket(updated);
    renderQueue();
    if (state.drawerId === id) { renderDrawerTicket(updated); refreshDrawer(); }
    refresh();
    toast(`${updated.number} reopened`, { type: "ok" });
  } catch (err) {
    toast(err.message, { type: "error" });
  }
}

/* ---- delegated queue events (§7.2: no inline handlers) ---- */

queuePanelEl.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  const row = e.target.closest(".row[data-id]");
  if (!row) return;
  const id = Number(row.dataset.id);
  if (button) {
    if (button.dataset.action === "take") assignTicket(id, state.actingAgent);
    else if (button.dataset.state === "Resolved") resolveFromRow(id);
    else changeState(id, button.dataset.state);
    return;
  }
  state.selectedId = id;
  applySelection();
  openDrawer(id);
});

$("#filters").addEventListener("click", (e) => {
  const button = e.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  for (const b of $("#filters").children) b.classList.toggle("active", b === button);
  renderQueue();
});

$("#search").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderQueue();
});

$("#vipBanner").addEventListener("click", () => {
  const id = Number($("#vipBanner").dataset.id);
  if (!id) return;
  const row = queueEl.querySelector(`[data-id="${id}"]`);
  if (row) row.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  openDrawer(id);
});

$("#resetDemo").addEventListener("click", async () => {
  if (!confirm("Reset demo data? Current tickets will be replaced with the seeded tableau.")) return;
  try {
    const res = await api("/api/demo/reset", { method: "POST" });
    closeDrawer();
    state.selectedId = null;
    await refresh();
    toast(res.message || "Demo data reset", { type: "ok" });
  } catch (err) {
    toast(err.message, { type: "error" });
  }
});

/* ================================================================ tick == */

// Runs every second. Touches text nodes, bar widths, and ramp classes only —
// never re-renders rows (§7.3). Paused (On Hold) rows are skipped: their
// instrument is frozen by renderQueue and hold time doesn't accrue on screen.
function tick() {
  const nowMs = now();
  $("#deskClock").textContent = fmtDeskTime(nowMs);
  if (!state.loaded) return;

  for (const id of state.queueIds) {
    const t = state.tickets.get(id);
    const sla = liveSla(t, nowMs);

    // Breach the moment it happens — no waiting for the next poll.
    if (t._lastLiveStatus !== "breached" && sla.status === "breached") {
      toast(`${t.number} breached SLA`, { type: "crit", duration: 6000 });
      renderVipBanner();
    }
    t._lastLiveStatus = sla.status;

    const row = queueEl.querySelector(`[data-id="${id}"]`);
    if (!row) continue; // filtered out of view, or mid re-render
    const age = row.querySelector(".age");
    if (age) age.textContent = fmtAge(t.created_at, nowMs); // wall-clock: ticks even On Hold
    if (t.state === "On Hold") continue; // instrument frozen while held
    updateRowSla(row, t, sla);
  }

  updateTitle();
  if (state.drawerId !== null) updateDrawerRing(nowMs);
}

/* ============================================================== drawer == */

const drawerEl = $("#drawer");
const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;
let drawerEvents = [];

async function openDrawer(id) {
  state.drawerId = id;
  drawerEl.classList.add("open");
  drawerEl.setAttribute("aria-hidden", "false");
  $("#drawerBackdrop").hidden = false;

  const cached = state.tickets.get(id);
  if (cached) renderDrawerTicket(cached);
  $("#drawerTimeline").innerHTML =
    '<div class="timeline-label">Timeline</div><p class="empty-sub">Loading timeline&#8230;</p>';
  refreshDrawer();
}

function closeDrawer() {
  if (state.drawerId === null) return;
  state.drawerId = null;
  drawerEvents = [];
  drawerEl.classList.remove("open");
  drawerEl.setAttribute("aria-hidden", "true");
  $("#drawerBackdrop").hidden = true;
}

// Fetches the drawer's ticket + timeline by id (poll piggybacks on this).
// Only the detail sections re-render; the composer keeps any in-progress
// draft because it is never rebuilt.
async function refreshDrawer() {
  const id = state.drawerId;
  if (id === null) return;
  try {
    const data = await api(`/api/tickets/${id}`);
    if (state.drawerId !== id) return; // drawer moved on while we fetched
    state.clockOffsetMs = Date.parse(data.now) - Date.now();
    applyTicket(data.ticket);
    drawerEvents = data.events;
    renderDrawerTicket(data.ticket);
    renderTimeline();
  } catch (err) {
    toast(err.message, { type: "error" });
  }
}

function renderDrawerTicket(t) {
  $("#drawerNumber").textContent = t.number;
  $("#drawerSubject").textContent = t.subject;
  renderDrawerIdentity(t);
  renderDrawerSla(t);
  renderDrawerControls(t);
  const closed = t.state === "Closed";
  $("#noteInput").disabled = closed;
  $("#noteSubmit").disabled = closed;
  $("#noteInput").placeholder = closed ? "Closed — notes are locked" : "Add a work note…";
}

function renderDrawerIdentity(t) {
  const pCode = `P${priorityRank(t.priority) + 1}`;
  const agent = agentByName(t.assigned_to);
  const options = [
    `<option value="" ${!t.assigned_to ? "selected" : ""}>Unassigned</option>`,
    ...state.meta.agents.map(
      (a) => `<option value="${escapeHtml(a.name)}" ${a.name === t.assigned_to ? "selected" : ""}>${escapeHtml(a.name)}</option>`
    ),
  ].join("");
  $("#drawerIdentity").innerHTML = `<div class="identity">
    <div class="identity-row">
      <span class="requester-name">${escapeHtml(t.requester)}</span>
      ${t.is_vip ? '<span class="chip vip-chip">&#9733; VIP</span>' : ""}
      <span class="type-tag">${t.ticket_type}</span>
      <span class="chip">${t.state}</span>
      ${t.reopened_count > 0 ? `<span class="tag-reopened">Reopened &times;${t.reopened_count}</span>` : ""}
    </div>
    <div class="identity-line"><span class="pcode">${pCode}</span> &middot; ${t.priority} &mdash; Impact ${t.impact} / Urgency ${t.urgency}</div>
    <div class="identity-assign">
      <span class="label">Assignee</span>
      ${agent
        ? `<span class="avatar" style="background:${escapeHtml(agent.color)}">${escapeHtml(agent.initials)}</span>`
        : '<span class="avatar unassigned">&middot;</span>'}
      <select data-assign id="assignSelect" name="assignee" aria-label="Assignee">${options}</select>
    </div>
  </div>`;
}

function renderDrawerSla(t) {
  const heldNow =
    t.held_minutes + (t.on_hold_since ? (now() - Date.parse(t.on_hold_since)) / 60000 : 0);
  $("#drawerSla").innerHTML = `<div class="drawer-sla-inner">
    <div class="ring-wrap" id="slaRing">
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
        <circle class="ring-bg" cx="48" cy="48" r="${RING_R}"/>
        <circle class="ring-fg" cx="48" cy="48" r="${RING_R}" stroke-dasharray="0 ${RING_C}"/>
      </svg>
      <div class="ring-center">
        <span class="ring-value num" id="ringValue"></span>
        <span class="ring-sub" id="ringSub"></span>
      </div>
    </div>
    <div class="sla-facts">
      <div><span class="k">Target</span><span class="num">${t.sla_target_min}m</span>${t.is_vip ? ' <span class="k">(VIP halved)</span>' : ""}</div>
      <div><span class="k">Elapsed</span><span class="num" id="ringElapsed"></span></div>
      ${heldNow > 0.5 ? `<div><span class="k">Held</span><span class="num">${Math.round(heldNow)}m</span></div>` : ""}
    </div>
  </div>`;
  updateDrawerRing(now());
}

// Mirrors the row instrument's ramp on the 96px ring; ticks with the 1s loop.
function updateDrawerRing(nowMs) {
  const t = state.tickets.get(state.drawerId);
  const wrap = $("#slaRing");
  if (!t || !wrap) return;
  const sla = liveSla(t, nowMs);
  const fg = wrap.querySelector(".ring-fg");
  const value = $("#ringValue");
  const sub = $("#ringSub");
  const elapsedEl = $("#ringElapsed");
  if (elapsedEl) elapsedEl.textContent = `${Math.max(0, Math.round(sla.elapsedMin))}m`;

  const setRing = (frac, cls) => {
    fg.setAttribute("stroke-dasharray", `${clamp01(frac) * RING_C} ${RING_C}`);
    wrap.className = `ring-wrap ${cls}`;
  };
  if (!isOpen(t)) {
    setRing(1, sla.status === "met" ? "ring-ok" : "ring-crit");
    value.textContent = `${Math.round(sla.elapsedMin)}m`;
    sub.textContent = sla.status === "met" ? "met" : "missed";
  } else if (sla.status === "breached") {
    setRing(1, "ring-crit");
    value.textContent = `+${fmtClock(-sla.remainingMin)}`;
    sub.textContent = "breached";
  } else if (sla.status === "paused") {
    setRing(sla.remainingMin / t.sla_target_min, "ring-muted");
    value.textContent = fmtClock(sla.remainingMin);
    sub.textContent = "paused";
  } else {
    setRing(sla.remainingMin / t.sla_target_min, sla.status === "at_risk" ? "ring-warn" : "ring-ok");
    value.textContent = fmtClock(sla.remainingMin);
    sub.textContent = "remaining";
  }
}

function renderDrawerControls(t) {
  const nextStates = state.meta.transitions[t.state] || [];
  let inner;
  if (nextStates.length === 0 && t.state !== "Resolved") {
    inner = '<div class="terminal-note">Closed &mdash; terminal state</div>';
  } else {
    inner = `<div class="controls-buttons">${[
      ...nextStates.map((s) => `<button type="button" class="seg-btn" data-drawer-state="${s}">${s}</button>`),
      ...(t.state === "Resolved"
        ? ['<button type="button" class="seg-btn reopen" data-drawer-reopen>Reopen</button>']
        : []),
    ].join("")}</div>`;
  }
  $("#drawerControls").innerHTML = `<div class="controls-label">State</div>${inner}`;
}

function eventDotColor(ev) {
  switch (ev.event_type) {
    case "created": return "var(--accent)";
    case "work_note": return "var(--text)";
    case "reopened": return "var(--warn)";
    case "assigned": {
      // "Assigned to {name}" → that agent's color; "Unassigned" → muted.
      const name = ev.detail.startsWith("Assigned to ") ? ev.detail.slice(12) : null;
      return agentByName(name)?.color || "var(--muted)";
    }
    default: return "var(--muted)"; // state_change
  }
}

function renderTimeline() {
  const nowMs = now();
  $("#drawerTimeline").innerHTML =
    '<div class="timeline-label">Timeline</div><div class="timeline">' +
    drawerEvents
      .map(
        (ev) => `<div class="tl-item ${ev._pending ? "pending" : ""}">
        <span class="tl-dot" style="background:${escapeHtml(eventDotColor(ev))}"></span>
        <div class="tl-head">
          <span class="tl-actor">${escapeHtml(ev.actor)}</span>
          <span class="tl-time num">${fmtRelative(ev.created_at, nowMs)}</span>
        </div>
        <div class="tl-detail">${escapeHtml(ev.detail)}</div>
      </div>`
      )
      .join("") +
    "</div>";
}

/* ---- drawer events ---- */

$("#drawerClose").addEventListener("click", closeDrawer);
$("#drawerBackdrop").addEventListener("click", closeDrawer);

$("#drawer").addEventListener("click", (e) => {
  const stateBtn = e.target.closest("[data-drawer-state]");
  if (stateBtn) {
    const next = stateBtn.dataset.drawerState;
    if (next === "Resolved") resolveFromRow(state.drawerId);
    else changeState(state.drawerId, next);
    return;
  }
  if (e.target.closest("[data-drawer-reopen]")) reopenTicket(state.drawerId);
});

$("#drawer").addEventListener("change", (e) => {
  const select = e.target.closest("[data-assign]");
  if (select) assignTicket(state.drawerId, select.value || null);
});

$("#noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = state.drawerId;
  const input = $("#noteInput");
  const text = input.value.trim();
  if (id === null || !text || input.disabled) return;

  // Optimistic append: show the note immediately, reconcile with the 201.
  const temp = {
    id: `pending-${Date.now()}`,
    actor: agentByName(state.actingAgent) ? state.actingAgent : "System",
    event_type: "work_note",
    detail: text,
    created_at: new Date(now()).toISOString(),
    _pending: true,
  };
  drawerEvents.unshift(temp);
  renderTimeline();
  const draft = input.value;
  input.value = "";

  try {
    const event = await api(`/api/tickets/${id}/notes`, { method: "POST", body: { note: text } });
    if (state.drawerId !== id) return;
    drawerEvents = drawerEvents.map((ev) => (ev === temp ? event : ev));
    renderTimeline();
    refresh();
  } catch (err) {
    drawerEvents = drawerEvents.filter((ev) => ev !== temp);
    if (state.drawerId === id) {
      renderTimeline();
      input.value = draft; // never lose a draft to a failed POST
    }
    toast(err.message, { type: "error" });
  }
});

/* ================================================================ form == */

function populateForm() {
  const meta = state.meta;
  const fill = (el, values, selected) => {
    el.innerHTML = values
      .map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v)}</option>`)
      .join("");
    el.disabled = false;
  };
  fill($("#fType"), meta.types, "Incident");
  fill($("#fImpact"), meta.impacts, "Medium");
  fill($("#fUrgency"), meta.urgencies, "Medium");
  updatePriorityPreview();
}

function populateAgentPicker() {
  const select = $("#agentSelect");
  select.innerHTML = state.meta.agents
    .map((a) => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`)
    .join("");
  const name = agentByName(state.actingAgent) ? state.actingAgent : state.meta.agents[0].name;
  select.value = name;
  setActingAgent(name);
}

$("#agentSelect").addEventListener("change", (e) => setActingAgent(e.target.value));

// Live preview from meta.priority_matrix — the matrix is never hardcoded
// client-side (§2.2). The VIP halving shown is §2.3's clock modifier.
function updatePriorityPreview() {
  if (!state.meta) return;
  const priority = state.meta.priority_matrix[`${$("#fImpact").value}|${$("#fUrgency").value}`];
  const badge = $("#ppBadge");
  badge.textContent = priority;
  badge.className = `pp-badge prio-${priority.toLowerCase()}`;
  const target = state.meta.sla_targets[priority];
  $("#ppTarget").textContent = `SLA ${$("#fVip").checked ? target / 2 : target}m`;
}

for (const id of ["#fImpact", "#fUrgency"]) $(id).addEventListener("change", updatePriorityPreview);
$("#fVip").addEventListener("change", updatePriorityPreview);

$("#ticketForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.meta) return;
  const errorEl = $("#formError");
  const button = $("#createBtn");
  button.disabled = true;
  try {
    const created = await api("/api/tickets", {
      method: "POST",
      body: {
        subject: $("#fSubject").value.trim(),
        requester: $("#fRequester").value.trim(),
        ticket_type: $("#fType").value,
        impact: $("#fImpact").value,
        urgency: $("#fUrgency").value,
        is_vip: $("#fVip").checked,
      },
    });
    errorEl.hidden = true;
    applyTicket(created);
    renderQueue(); // the demo beat: a VIP ticket FLIP-leaps everything down
    refresh();
    e.target.reset();
    populateForm();
    $("#fSubject").focus();
  } catch (err) {
    errorEl.textContent = err.message; // shown until the next submit — never silently cleared
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
  }
});

/* =========================================================== shortcuts == */

const overlayEl = $("#shortcutsOverlay");

function toggleOverlay(force) {
  overlayEl.hidden = force !== undefined ? !force : !overlayEl.hidden;
}

$("#overlayClose").addEventListener("click", () => toggleOverlay(false));
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) toggleOverlay(false);
});

function moveSelection(dir) {
  const ids = visibleQueueIds();
  if (ids.length === 0) return;
  const idx = ids.indexOf(state.selectedId);
  const nextIdx = idx === -1 ? (dir > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, idx + dir));
  state.selectedId = ids[nextIdx];
  applySelection();
  queueEl
    .querySelector(`[data-id="${state.selectedId}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
}

function shortcutTransition(nextState) {
  if (state.selectedId === null) return;
  const t = state.tickets.get(state.selectedId);
  if (!t || !state.meta) return;
  if (!state.meta.transitions[t.state]?.includes(nextState)) {
    shakeRow(t.id); // illegal move: 150ms shake, no request
    return;
  }
  if (nextState === "Resolved") resolveFromRow(t.id);
  else changeState(t.id, nextState);
}

document.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  // Hard early-return while typing (§7.6).
  if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === "?") { e.preventDefault(); toggleOverlay(); return; }
  if (e.key === "Escape") {
    if (!overlayEl.hidden) toggleOverlay(false);
    else if (state.drawerId !== null) closeDrawer();
    else { state.selectedId = null; applySelection(); }
    return;
  }
  if (!overlayEl.hidden) return; // other keys are inert under the overlay

  switch (e.key) {
    case "n": e.preventDefault(); $("#fSubject").focus(); break;
    case "/": e.preventDefault(); $("#search").focus(); break;
    case "j": moveSelection(1); break;
    case "k": moveSelection(-1); break;
    case "Enter": if (state.selectedId !== null) openDrawer(state.selectedId); break;
    case "1": shortcutTransition("In Progress"); break;
    case "2": shortcutTransition("On Hold"); break;
    case "3": shortcutTransition("Resolved"); break;
  }
});

/* ============================================================== toasts == */

const toastsEl = $("#toasts");

// type: info | ok | error | crit. Returns { dismiss } so callers can retract
// (e.g. an undo toast for a PATCH that ends up failing). Max 3 on screen.
function toast(message, { type = "info", action, onAction, duration = 4000 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message;
  el.append(msg);

  const dismiss = () => {
    clearTimeout(timer);
    if (!el.parentNode) return;
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action;
    btn.addEventListener("click", () => { dismiss(); onAction(); });
    el.append(btn);
  }

  toastsEl.append(el);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  const timer = setTimeout(dismiss, duration);
  return { dismiss };
}

/* ================================================================ boot == */

async function boot() {
  // Arm the skeleton shimmer only if the first fetch drags past 300ms —
  // instant loads should never flash loading chrome (§7.7).
  setTimeout(() => {
    if (!state.loaded) document.body.classList.add("shimmer-on");
  }, 300);

  await Promise.all([loadMeta(), fetchTickets()]);
  renderAll(); // no-op unless both meta and tickets landed

  setInterval(fetchTickets, 15000);
  setInterval(tick, 1000);
  tick();
}

boot();
