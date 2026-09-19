const ROWS: [string[], string][] = [
  [["n"], "New ticket (focus subject)"], [["/"], "Search the queue"], [["j", "k"], "Move selection down / up"],
  [["Enter"], "Open selected ticket"], [["1"], "Selected → In Progress"], [["2"], "Selected → On Hold"],
  [["3"], "Selected → Resolved"], [["Esc"], "Close drawer / clear selection"], [["?"], "Toggle this overlay"],
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className="overlay" hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="overlay-head"><h2>Keyboard shortcuts</h2><button type="button" className="icon-btn" aria-label="Close shortcuts" onClick={onClose}>&#10005;</button></div>
        <dl className="shortcut-list">
          {ROWS.map(([keys, label]) => <div className="shortcut" key={label}><dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{label}</dd></div>)}
        </dl>
      </div>
    </div>
  );
}
