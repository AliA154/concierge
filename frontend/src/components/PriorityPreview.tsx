import type { Level, Meta } from "../api/types";

export function PriorityPreview({ meta, impact, urgency, isVip }: { meta: Meta; impact: Level; urgency: Level; isVip: boolean }) {
  const priority = meta.priority_matrix[`${impact}|${urgency}`] ?? "Medium";
  const target = meta.sla_targets[priority];
  return (
    <div className="priority-preview">
      <span className="pp-label">Priority</span>
      <span className={`pp-badge prio-${priority.toLowerCase()}`}>{priority}</span>
      <span className="pp-target num">SLA {isVip ? target / 2 : target}m</span>
    </div>
  );
}
