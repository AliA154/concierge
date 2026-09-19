import { useState, type FormEvent, type RefObject } from "react";
import type { CreateTicketBody, Level, Meta, TicketType } from "../api/types";
import { PriorityPreview } from "./PriorityPreview";

interface Props { meta: Meta; onCreate: (body: CreateTicketBody) => Promise<unknown>; subjectRef?: RefObject<HTMLInputElement>; }

export function TicketForm({ meta, onCreate, subjectRef }: Props) {
  const [subject, setSubject] = useState("");
  const [requester, setRequester] = useState("");
  const [ticketType, setTicketType] = useState<TicketType>("Incident");
  const [impact, setImpact] = useState<Level>("Medium");
  const [urgency, setUrgency] = useState<Level>("Medium");
  const [isVip, setIsVip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate({ subject: subject.trim(), requester: requester.trim(), ticket_type: ticketType, impact, urgency, is_vip: isVip });
      setError(null);
      setSubject(""); setRequester(""); setTicketType("Incident"); setImpact("Medium"); setUrgency("Medium"); setIsVip(false);
      subjectRef?.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed"); // stays until the next submit
    } finally {
      setBusy(false);
    }
  };

  const select = <T extends string>(label: string, value: T, values: readonly T[], set: (v: T) => void) => (
    <label className="field"><span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value as T)}>{values.map((v) => <option key={v} value={v}>{v}</option>)}</select>
    </label>
  );

  return (
    <aside className="panel form-panel">
      <h2 className="panel-title">New ticket</h2>
      <form autoComplete="off" noValidate onSubmit={(e) => void submit(e)}>
        <label className="field"><span>Subject</span><input ref={subjectRef} aria-label="Subject" maxLength={200} placeholder="Short description" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="field"><span>Requester</span><input aria-label="Requester" maxLength={200} placeholder="Who is affected" value={requester} onChange={(e) => setRequester(e.target.value)} /></label>
        {select("Type", ticketType, meta.types, setTicketType)}
        <div className="field-row">
          {select("Impact", impact, meta.impacts, setImpact)}
          {select("Urgency", urgency, meta.urgencies, setUrgency)}
        </div>
        <PriorityPreview meta={meta} impact={impact} urgency={urgency} isVip={isVip} />
        <label className="vip-toggle">
          <input type="checkbox" checked={isVip} onChange={(e) => setIsVip(e.target.checked)} />
          <span className="vip-box" aria-hidden="true">&#9733;</span>
          <span>VIP requester</span>
          <span className="vip-note">SLA halved</span>
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>Create ticket</button>
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
    </aside>
  );
}
