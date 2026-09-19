import type { Meta } from "../api/types";
import { fmtDeskTime } from "../lib/format";
import { useNow } from "../hooks/useNow";
import { AgentPicker } from "./AgentPicker";

interface Props { meta: Meta | null; offline: boolean; actingAgent: string; onAgentChange: (name: string) => void; }

export function TopBar({ meta, offline, actingAgent, onAgentChange }: Props) {
  const nowMs = useNow();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-glyph" aria-hidden="true">&#9670;</span>
        <span className="brand-name">Concierge</span>
        <span className="tagline">VIP-aware service desk</span>
      </div>
      <div className="topbar-right">
        <span className="reconnect-pill" hidden={!offline}>Reconnecting…</span>
        <span className="topbar-hint">Press <kbd>?</kbd> for shortcuts</span>
        <span className="desk-time">Desk time <span className="num">{fmtDeskTime(nowMs)}</span> UTC</span>
        {meta && <AgentPicker meta={meta} value={actingAgent} onChange={onAgentChange} />}
      </div>
    </header>
  );
}
