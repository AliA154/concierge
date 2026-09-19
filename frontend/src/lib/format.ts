export function fmtClock(minutes: number): string {
  const totalSec = Math.max(0, Math.round(minutes * 60));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function fmtAge(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function fmtRelative(iso: string, nowMs: number): string {
  const mins = Math.floor((nowMs - Date.parse(iso)) / 60000);
  return mins < 1 ? "just now" : `${fmtAge(iso, nowMs)} ago`;
}

export function fmtDeskTime(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
