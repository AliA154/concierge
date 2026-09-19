import { useState } from "react";
import { useActingAgent } from "./hooks/useActingAgent";
import { useMeta } from "./hooks/useMeta";
import { NowProvider } from "./hooks/useNow";
import { useTickets } from "./hooks/useTickets";
import { Queue, type QueueFilter } from "./components/Queue";
import { ToastProvider, useToast } from "./components/Toasts";
import { TopBar } from "./components/TopBar";

function Desk() {
  const meta = useMeta();
  const [actingAgent, setActingAgent] = useActingAgent(meta);
  const toast = useToast();
  const { store } = useTickets({ actingAgent, priorities: meta?.priorities ?? [], agentNames: meta?.agents.map((a) => a.name) ?? [], transitions: meta?.transitions ?? null, toast });
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  return (
    <NowProvider offsetMs={store.clockOffsetMs}>
      <TopBar meta={meta} offline={store.offline} actingAgent={actingAgent} onAgentChange={setActingAgent} />
      <main className="wrap">
        <div className="columns">
          {meta && store.loaded && (
            <Queue store={store} meta={meta} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} selectedId={selectedId} onSelect={setSelectedId} onOpen={() => undefined} onTake={() => undefined} onQuickState={() => undefined} />
          )}
        </div>
      </main>
    </NowProvider>
  );
}

export function App() {
  return <ToastProvider><Desk /></ToastProvider>;
}
