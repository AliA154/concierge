import { useState, useRef } from "react";
import { useActingAgent } from "./hooks/useActingAgent";
import { useMeta } from "./hooks/useMeta";
import { NowProvider } from "./hooks/useNow";
import { useTickets } from "./hooks/useTickets";
import { useBreachWatch } from "./hooks/useBreachWatch";
import { Queue, type QueueFilter } from "./components/Queue";
import { MetricsTiles } from "./components/MetricsTiles";
import { VipBanner } from "./components/VipBanner";
import { ToastProvider, useToast } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { TicketForm } from "./components/TicketForm";
import type { Store } from "./lib/store";

function Watch({ store }: { store: Store }) {
  useBreachWatch(store, useToast());
  return null;
}

function Desk() {
  const meta = useMeta();
  const [actingAgent, setActingAgent] = useActingAgent(meta);
  const toast = useToast();
  const { store, changeState, assignTicket, createTicket } = useTickets({ actingAgent, priorities: meta?.priorities ?? [], agentNames: meta?.agents.map((a) => a.name) ?? [], transitions: meta?.transitions ?? null, toast });
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const openDrawer = () => undefined;
  return (
    <NowProvider offsetMs={store.clockOffsetMs}>
      <Watch store={store} />
      <TopBar meta={meta} offline={store.offline} actingAgent={actingAgent} onAgentChange={setActingAgent} />
      <main className="wrap">
        <VipBanner store={store} onOpen={openDrawer} />
        {store.metrics && <MetricsTiles metrics={store.metrics} />}
        <div className="columns">
          {meta && <TicketForm meta={meta} onCreate={createTicket} subjectRef={subjectRef} />}
          {meta && store.loaded && (
            <Queue store={store} meta={meta} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} selectedId={selectedId} onSelect={setSelectedId} onOpen={openDrawer} onTake={(id) => void assignTicket(id, actingAgent)} onQuickState={(id, next) => void changeState(id, next)} />
          )}
        </div>
      </main>
    </NowProvider>
  );
}

export function App() {
  return <ToastProvider><Desk /></ToastProvider>;
}
