"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { NAV, navFor, type NavItem } from "@/lib/nav";
import { cityFromTimezone } from "@/lib/client";
import { AgentAvatar } from "./icons";
import { StatusProvider, useStatus } from "./StatusProvider";
import { CommandPalette } from "./CommandPalette";
import { ToastProvider } from "./ui";

const GROUPS: { id: NavItem["group"]; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "agents", label: "Agents" },
  { id: "self", label: "Self" },
];

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const { status } = useStatus();
  const online = item.agent ? status?.agents[item.agent]?.online : undefined;
  return (
    <Link href={item.href} className={`nav-item ${active ? "active" : ""}`} style={{ ["--item" as string]: item.accent }} onClick={onClick}>
      {item.agent ? <AgentAvatar id={item.agent} /> : item.icon && <item.icon size={20} />}
      <span>{item.label}</span>
      {online !== undefined && <span className={`dot ${online ? "on" : ""}`} title={online ? "online" : "offline"} />}
    </Link>
  );
}

function Sidebar({ open, close }: { open: boolean; close: () => void }) {
  const pathname = usePathname();
  const current = navFor(pathname);
  const [city, setCity] = useState("local");
  useEffect(() => setCity(cityFromTimezone()), []);
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand">
        <div className="where">Local · {city}</div>
        <div className="name">Agentic OS</div>
      </div>
      {GROUPS.map((g) => (
        <div key={g.id}>
          <div className="nav-group">{g.label}</div>
          {NAV.filter((n) => n.group === g.id).map((n) => (
            <NavLink key={n.href} item={n} active={current.href === n.href} onClick={close} />
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        {NAV.filter((n) => n.group === "system").map((n) => (
          <NavLink key={n.href} item={n} active={current.href === n.href} onClick={close} />
        ))}
      </div>
    </aside>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = navFor(pathname);
  const [open, setOpen] = useState(false);
  return (
    <StatusProvider>
      <ToastProvider>
        <div className="shell">
          <Sidebar open={open} close={() => setOpen(false)} />
          <div style={{ minWidth: 0 }}>
            <div className="mobile-bar">
              <button className="btn icon ghost" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>
                <Menu size={20} />
              </button>
              <span className="brand" style={{ padding: 0 }}>
                <span className="name" style={{ margin: 0, fontSize: 18 }}>Agentic OS</span>
              </span>
            </div>
            <main className="main" style={{ ["--accent" as string]: current.accent }} onClick={() => open && setOpen(false)}>
              {children}
            </main>
          </div>
        </div>
        <CommandPalette />
      </ToastProvider>
    </StatusProvider>
  );
}
