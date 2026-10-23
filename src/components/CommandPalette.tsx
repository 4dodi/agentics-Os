"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, MessageSquare, Plus, Rocket, Search } from "lucide-react";
import { AGENT_META, NAV } from "@/lib/nav";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function handoff(agent: string, text: string) {
  try {
    sessionStorage.setItem(`handoff:${agent}`, text);
  } catch {
    /* storage unavailable */
  }
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const go = (href: string) => () => router.push(href);

  const cmds = useMemo<Cmd[]>(() => {
    const query = q.trim();
    const pages: Cmd[] = NAV.map((n) => ({
      id: n.href,
      label: n.label,
      hint: n.hint,
      icon: n.icon ? <n.icon size={17} /> : <MessageSquare size={17} color={n.accent} />,
      run: go(n.href),
    }));
    const actions: Cmd[] = [
      { id: "journal", label: "Add journal entry", hint: "Journal", icon: <Plus size={17} />, run: go("/journal") },
      { id: "seo-gen", label: "Generate SEO articles", hint: "SEO", icon: <Rocket size={17} />, run: go("/seo?tab=generate") },
      { id: "seo-deploy", label: "Deploy sites to Netlify", hint: "SEO", icon: <Rocket size={17} />, run: go("/seo?tab=deploy") },
      { id: "goal", label: "New goal", hint: "Goals", icon: <Plus size={17} />, run: go("/goals") },
      { id: "note", label: "Search memory", hint: "Memory", icon: <Search size={17} />, run: go(`/memory${query ? `?q=${encodeURIComponent(query)}` : ""}`) },
    ];
    const ask: Cmd[] = query
      ? (Object.keys(AGENT_META) as (keyof typeof AGENT_META)[]).map((a) => ({
          id: `ask-${a}`,
          label: `Ask ${AGENT_META[a].label}: “${query}”`,
          hint: "send",
          icon: <ArrowRight size={17} color={AGENT_META[a].accent} />,
          run: () => {
            handoff(a, query);
            sessionStorage.setItem(`autosend:${a}`, "1");
            router.push(`/${a}`);
          },
        }))
      : [];
    const all = [...pages, ...actions];
    const lower = query.toLowerCase();
    const matched = lower ? all.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(lower)) : all;
    return [...matched, ...ask];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (!open) return null;
  const runAt = (i: number) => {
    cmds[i]?.run();
    setOpen(false);
  };

  return (
    <div className="palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          placeholder="Jump to a page, run an action, or ask an agent…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(cmds.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") runAt(sel);
          }}
        />
        <ul>
          {cmds.map((c, i) => (
            <li key={c.id} className={i === sel ? "sel" : ""} onMouseEnter={() => setSel(i)} onClick={() => runAt(i)}>
              {c.icon}
              <span>{c.label}</span>
              {c.hint && <span className="h">{c.hint}</span>}
            </li>
          ))}
          {!cmds.length && <li className="faint">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
