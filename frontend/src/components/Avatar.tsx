import type { Agent } from "../api/types";

export function Avatar({ agent, title }: { agent: Agent | null; title?: string }) {
  if (!agent) return <span className="avatar unassigned" title={title ?? "Unassigned"}>&middot;</span>;
  return <span className="avatar" style={{ background: agent.color }} title={title ?? agent.name}>{agent.initials}</span>;
}

export const agentByName = (agents: readonly Agent[], name: string | null): Agent | null =>
  agents.find((a) => a.name === name) ?? null;
