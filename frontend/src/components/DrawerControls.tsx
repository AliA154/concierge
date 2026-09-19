import type { Meta, State, Ticket } from "../api/types";

export function DrawerControls({ ticket: t, meta, onChangeState, onReopen }: { ticket: Ticket; meta: Meta; onChangeState: (next: State) => void; onReopen: () => void }) {
  const next = meta.transitions[t.state] ?? [];
  return (
    <div>
      <div className="controls-label">State</div>
      {next.length === 0 && t.state !== "Resolved"
        ? <div className="terminal-note">Closed — terminal state</div>
        : <div className="controls-buttons">
            {next.map((s) => <button key={s} type="button" className="seg-btn" onClick={() => onChangeState(s)}>{s}</button>)}
            {t.state === "Resolved" && <button type="button" className="seg-btn reopen" onClick={onReopen}>Reopen</button>}
          </div>}
    </div>
  );
}
