export function QueueClear() {
  return (
    <div className="empty-state">
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="none" stroke="var(--ok)" strokeWidth="2" />
        <path d="M15 24.5l6 6 12-13" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="empty-title">Queue clear</p>
      <p className="empty-sub">New tickets appear here, sorted VIP first.</p>
    </div>
  );
}

export function NoMatch() {
  return <div className="empty-state slim"><p className="empty-sub">No open tickets match this view.</p></div>;
}
