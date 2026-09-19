import { useEffect } from "react";
import type { Meta, State } from "../api/types";
import type { Store } from "../lib/store";
import { useTicketDetail } from "../hooks/useTicketDetail";
import { useToast } from "./Toasts";
import { DrawerIdentity } from "./DrawerIdentity";
import { SlaRing } from "./SlaRing";
import { DrawerControls } from "./DrawerControls";
import { Timeline } from "./Timeline";
import { NoteComposer } from "./NoteComposer";

interface Props {
  id: number | null; store: Store; meta: Meta; actingAgent: string;
  onClose: () => void; onChangeState: (id: number, next: State) => void; onAssign: (id: number, name: string | null) => void; onReopen: (id: number) => void;
}

export function Drawer({ id, store, meta, actingAgent, onClose, onChangeState, onAssign, onReopen }: Props) {
  const toast = useToast();
  const { ticket, events, refresh, addNote } = useTicketDetail(id, store, actingAgent, toast);
  const open = id !== null;
  // Poll piggyback: whenever the store changes, refresh the timeline (the composer keeps its draft).
  useEffect(() => { if (open) void refresh(); }, [store, open, refresh]);
  return (
    <>
      <div className="drawer-backdrop" hidden={!open} onClick={onClose} />
      <aside className={`drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Ticket detail" aria-hidden={!open}>
        <header className="drawer-head">
          <div className="drawer-title"><span className="drawer-number num">{ticket?.number}</span><h2>{ticket?.subject}</h2></div>
          <button type="button" className="icon-btn" aria-label="Close drawer" onClick={onClose}>&#10005;</button>
        </header>
        {ticket && id !== null && (
          <div className="drawer-body">
            <DrawerIdentity ticket={ticket} meta={meta} onAssign={(name) => onAssign(id, name)} />
            <SlaRing ticket={ticket} />
            <DrawerControls ticket={ticket} meta={meta} onChangeState={(s) => onChangeState(id, s)} onReopen={() => onReopen(id)} />
            <Timeline events={events} meta={meta} loading={events.length === 0} />
            <NoteComposer locked={ticket.state === "Closed"} onSubmit={addNote} />
          </div>
        )}
      </aside>
    </>
  );
}
