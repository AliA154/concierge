import { useState, type FormEvent } from "react";

export function NoteComposer({ locked, onSubmit }: { locked: boolean; onSubmit: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    setDraft("");
    const ok = await onSubmit(text);
    if (!ok) setDraft(text); // never lose a draft to a failed POST
  };
  return (
    <form className="composer" onSubmit={(e) => void submit(e)}>
      <textarea aria-label="Work note" maxLength={1000} rows={3} disabled={locked} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={locked ? "Closed — notes are locked" : "Add a work note…"} />
      <button type="submit" className="btn-primary btn-small" disabled={locked}>Add note</button>
    </form>
  );
}
