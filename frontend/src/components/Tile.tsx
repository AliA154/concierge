import type { ReactNode } from "react";
import { useTween } from "../hooks/useTween";

interface Props { name: string; label: string; value: number; format: (v: number) => string; context: string; className?: string; extra?: ReactNode; }

export function Tile({ name, label, value, format, context, className = "", extra }: Props) {
  const shown = useTween(value);
  return (
    <div className={`tile ${className}`} data-tile={name}>
      <div className="tile-label">{label}</div>
      <div className="tile-valuerow"><span className="tile-value num">{format(shown)}</span>{extra}</div>
      <div className="tile-context">{context}</div>
    </div>
  );
}
