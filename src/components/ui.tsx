"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: TabDef<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? "active" : ""}`} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon size={16} />}
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function LivePill({ online, label, warn }: { online: boolean | null; label?: string; warn?: boolean }) {
  const cls = online === null ? "" : warn ? "warn" : online ? "live" : "off";
  return (
    <span className={`pill ${cls}`}>
      <span className="d" />
      {label ?? (online === null ? "…" : online ? "Live" : "Offline")}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function SectionTitle({ icon: Icon, title, meta, children }: { icon?: LucideIcon; title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="section-title">
      {Icon && <Icon size={18} />}
      <h2>{title}</h2>
      {meta && <span className="eyebrow">{meta}</span>}
      <span className="spacer" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((text: string, error = false) => setToast({ id: Date.now(), text, error }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
