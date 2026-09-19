import type { Meta } from "../api/types";
import { agentByName } from "./Avatar";

interface Props { meta: Meta; value: string; onChange: (name: string) => void; }

export function AgentPicker({ meta, value, onChange }: Props) {
  const agent = agentByName(meta.agents, value);
  return (
    <label className="agent-picker" title="Cosmetic identity — sent as X-Agent on every action">
      <span className="agent-picker-label">Acting as</span>
      <span className="avatar" aria-hidden="true" style={{ background: agent?.color ?? "" }}>{agent?.initials ?? "?"}</span>
      <select aria-label="Acting as agent" value={value} onChange={(e) => onChange(e.target.value)}>
        {meta.agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
      </select>
    </label>
  );
}
