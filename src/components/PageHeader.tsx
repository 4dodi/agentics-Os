"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useStatus } from "./StatusProvider";
import { AGENT_IDS } from "@/lib/types";

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);
  return <span>{now || "--:--"} · Local</span>;
}

export function SystemsIndicator() {
  const { status } = useStatus();
  const enabled = status ? AGENT_IDS.filter((id) => status.agents[id].enabled) : [];
  const online = enabled.filter((id) => status!.agents[id].online).length;
  const label = !status ? "Checking" : online === enabled.length ? "All systems" : online ? `${online}/${enabled.length} systems` : "Systems down";
  return (
    <span className="chip-btn systems" title={status ? enabled.map((id) => `${id}: ${status.agents[id].online ? "online" : "offline"}`).join("\n") : ""}>
      <span className="bars">
        {[6, 9, 12, 14].map((h, i) => (
          <i key={i} className={i < Math.round((online / Math.max(1, enabled.length)) * 4) ? "on" : ""} style={{ height: h }} />
        ))}
      </span>
      {label}
    </span>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">
          <Clock />
        </div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="head-actions">
        {children}
        <button className="chip-btn" onClick={() => window.dispatchEvent(new Event("open-palette"))}>
          <kbd>⌘K</kbd> Command palette
        </button>
        <SystemsIndicator />
      </div>
    </header>
  );
}
