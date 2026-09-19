import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Meta } from "../api/types";

export const META_RETRY_MS = 3000;

// Nothing renders without meta, so retry quietly until it lands.
export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const m = await api<Meta>("/api/meta");
        if (!cancelled) setMeta(m);
      } catch {
        if (!cancelled) timer = setTimeout(load, META_RETRY_MS);
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  return meta;
}
