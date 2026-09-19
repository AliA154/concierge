import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastType = "info" | "ok" | "error" | "crit";
export interface ToastOptions { type?: ToastType; action?: string; onAction?: () => void; duration?: number; }
export type ToastFn = (message: string, opts?: ToastOptions) => { dismiss: () => void };

interface ToastItem { id: number; message: string; type: ToastType; action?: string; onAction?: () => void; out: boolean; }

const ToastContext = createContext<ToastFn>(() => ({ dismiss: () => undefined }));
export const useToast = (): ToastFn => useContext(ToastContext);

const MAX_VISIBLE = 3;
const EXIT_MS = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const toast = useCallback<ToastFn>((message, { type = "info", action, onAction, duration = 4000 } = {}) => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, message, type, action, onAction, out: false }].slice(-MAX_VISIBLE));
    const timer = setTimeout(() => remove(id), duration);
    return { dismiss: () => { clearTimeout(timer); remove(id); } };
  }, [remove]);

  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.type} ${t.out ? "out" : ""}`}>
            <span className="toast-msg">{t.message}</span>
            {t.action && <button type="button" className="toast-action" onClick={() => { remove(t.id); t.onAction?.(); }}>{t.action}</button>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
