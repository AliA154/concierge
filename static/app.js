// Concierge front end. Polls the API, renders the prioritized queue, and
// lets the desk create tickets and move them through ITIL states.

const STATES = ["New", "In Progress", "On Hold", "Resolved"];

async function loadMeta() {
  const meta = await fetch("/api/meta").then((r) => r.json());
  fillSelect("type-select", meta.types);
  fillSelect("priority-select", meta.priorities, "Medium");
}

function fillSelect(id, options, selected) {
  const el = document.getElementById(id);
  el.innerHTML = options
    .map((o) => `<option ${o === selected ? "selected" : ""}>${o}</option>`)
    .join("");
}

function slaLabel(t) {
  if (t.state === "Resolved") {
    return `<div class="sla ${t.sla_breached ? "breached" : "ok"}">
      <div class="clock">${t.sla_breached ? "Missed" : "Met"}</div>
      <div class="target">resolved in ${t.elapsed_min}m</div></div>`;
  }
  const mins = t.sla_remaining_min;
  const cls = t.sla_breached ? "breached" : "ok";
  const text = t.sla_breached ? `${Math.abs(mins)}m over` : `${mins}m left`;
  return `<div class="sla ${cls}">
    <div class="clock">${text}</div>
    <div class="target">SLA ${t.sla_target_min}m</div></div>`;
}

function stateControls(t) {
  return `<div class="controls">${STATES.map(
    (s) =>
      `<button class="state-btn ${s === t.state ? "active" : ""}"
        onclick="setState(${t.id}, '${s}')">${s}</button>`
  ).join("")}</div>`;
}

function ticketCard(t) {
  const classes = ["ticket"];
  if (t.is_vip) classes.push("vip");
  if (t.priority === "Critical") classes.push("crit");
  const vipTag = t.is_vip ? `<span class="tag vip">★ VIP</span>` : "";
  return `<div class="${classes.join(" ")}">
    <div class="subject">${escapeHtml(t.subject)}</div>
    <div class="meta">
      ${vipTag}
      <span class="tag">${t.ticket_type}</span>
      <span class="tag pri-${t.priority}">${t.priority}</span>
      <span>${escapeHtml(t.requester)}</span>
    </div>
    ${slaLabel(t)}
    ${stateControls(t)}
  </div>`;
}

function metricCard(value, label, cls = "") {
  return `<div class="metric ${cls}"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

async function refresh() {
  const data = await fetch("/api/tickets").then((r) => r.json());
  const m = data.metrics;

  document.getElementById("metrics").innerHTML = [
    metricCard(m.open, "Open"),
    metricCard(m.vip_open, "VIP open", m.vip_open ? "" : ""),
    metricCard(m.breaching, "SLA breaching", m.breaching ? "alert" : ""),
    metricCard(m.resolved, "Resolved"),
    metricCard(m.mttr_min + "m", "Avg resolve"),
    metricCard(m.sla_met_pct + "%", "SLA met", m.sla_met_pct >= 90 ? "good" : ""),
  ].join("");

  document.getElementById("queue-count").textContent = data.queue.length;
  document.getElementById("queue").innerHTML =
    data.queue.map(ticketCard).join("") ||
    `<div class="empty">No open tickets. Queue is clear.</div>`;
  document.getElementById("resolved").innerHTML =
    data.resolved.map(ticketCard).join("") ||
    `<div class="empty">Nothing resolved yet.</div>`;
}

async function setState(id, state) {
  await fetch(`/api/tickets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  refresh();
}

document.getElementById("ticket-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  await fetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: f.subject.value,
      requester: f.requester.value,
      ticket_type: f.ticket_type.value,
      priority: f.priority.value,
      is_vip: f.is_vip.checked,
    }),
  });
  f.reset();
  fillSelect("priority-select", ["Low", "Medium", "High", "Critical"], "Medium");
  refresh();
});

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Refresh every 15s so SLA clocks tick down on their own.
loadMeta().then(refresh);
setInterval(refresh, 15000);

window.setState = setState;
