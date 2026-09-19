import { useEffect, useState, useRef } from "react";
import { useActingAgent } from "./hooks/useActingAgent";
import { useMeta } from "./hooks/useMeta";
import { NowProvider } from "./hooks/useNow";
import { useTickets } from "./hooks/useTickets";
import { useBreachWatch } from "./hooks/useBreachWatch";
import { Queue, type QueueFilter } from "./components/Queue";
import { MetricsTiles } from "./components/MetricsTiles";
import { Shortcuts } from "./components/Shortcuts";
import { ShortcutsOverlay } from "./components/ShortcutsOverlay";
import { VipBanner } from "./components/VipBanner";
import { ToastProvider, useToast } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { TicketForm } from "./components/TicketForm";
import { Drawer } from "./components/Drawer";
import type { Store } from "./lib/store";

const SHAKE_MS = 150;

function Watch({ store }: { store: Store }) {
  useBreachWatch(store, useToast());
  return null;
}

function Desk() {
  const meta = useMeta();
  const [actingAgent, setActingAgent] = useActingAgent(meta);
  const toast = useToast();
  const { store, changeState, assignTicket, createTicket, reopenTicket, resetDemo } = useTickets({ actingAgent, priorities: meta?.priorities ?? [], agentNames: meta?.agents.map((a) => a.name) ?? [], transitions: meta?.transitions ?? null, toast });
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const openDrawer = (id: number) => setDrawerId(id);

  useEffect(() => {
    if (shakeId === null) return;
    const timer = setTimeout(() => setShakeId(null), SHAKE_MS);
    return () => clearTimeout(timer);
  }, [shakeId]);

  const onReset = async () => {
    if (!window.confirm("Reset demo data? Current tickets will be replaced with the seeded tableau.")) return;
    try {
      setDrawerId(null);
      setSelectedId(null);
      toast(await resetDemo(), { type: "ok" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Request failed", { type: "error" });
    }
  };

  return (
    <NowProvider offsetMs={store.clockOffsetMs}>
      <Watch store={store} />
      {meta && (
        <Shortcuts store={store} meta={meta} filter={filter} search={search} selectedId={selectedId} setSelectedId={setSelectedId} drawerId={drawerId} setDrawerId={setDrawerId} overlayOpen={overlayOpen} setOverlayOpen={setOverlayOpen} subjectRef={subjectRef} changeState={changeState} setShakeId={setShakeId} />
      )}
      <TopBar meta={meta} offline={store.offline} actingAgent={actingAgent} onAgentChange={setActingAgent} />
      <main className="wrap">
        <VipBanner store={store} onOpen={openDrawer} />
        {store.metrics && <MetricsTiles metrics={store.metrics} />}
        <div className="columns">
          {meta && <TicketForm meta={meta} onCreate={createTicket} subjectRef={subjectRef} />}
          {meta && store.loaded && (
            <Queue store={store} meta={meta} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} selectedId={selectedId} onSelect={setSelectedId} onOpen={openDrawer} onTake={(id) => void assignTicket(id, actingAgent)} onQuickState={(id, next) => void changeState(id, next)} shakeId={shakeId} />
          )}
        </div>
      </main>
      {meta && <Drawer id={drawerId} store={store} meta={meta} actingAgent={actingAgent} onClose={() => setDrawerId(null)} onChangeState={(id, s) => void changeState(id, s)} onAssign={(id, n) => void assignTicket(id, n)} onReopen={(id) => void reopenTicket(id)} />}
      <footer className="footer">
        Press <kbd>?</kbd> for shortcuts ·{" "}
        <button type="button" className="linklike" onClick={() => void onReset()}>Reset demo data</button>
      </footer>
      <ShortcutsOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} />
    </NowProvider>
  );
}

export function App() {
  return <ToastProvider><Desk /></ToastProvider>;
}
