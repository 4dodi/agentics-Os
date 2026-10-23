"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, KanbanSquare, Play, Plus, RefreshCw, Terminal, Trash2, Wand2 } from "lucide-react";
import type { AgentId, AgentStatus, KanbanCard } from "@/lib/types";
import { api, timeAgo } from "@/lib/client";
import { Markdown } from "./Markdown";
import { Empty, LivePill, SectionTitle, Spinner, useToast } from "./ui";

type Agent = Exclude<AgentId, "api">;

interface Info {
  status: AgentStatus;
  bin: string | null;
  cwd?: string;
  model?: string;
  provider?: string;
  skills?: { name: string; description: string; category: string }[];
  sessions?: number;
  agents?: string[];
}

// Suggestions only — real subcommands vary by agent version; anything typed is passed through as argv.
const QUICK: Record<Agent, string[]> = {
  claude: ["--version", "mcp list", "--help"],
  hermes: ["--version", "skills list", "sessions list", "--help"],
  openclaw: ["--version", "status", "agents list", "gateway status", "--help"],
};

interface Line {
  kind: "cmd" | "out" | "err";
  text: string;
}

function Console({ agent, bin }: { agent: Agent; bin: string }) {
  const [lines, setLines] = useState<Line[]>([{ kind: "out", text: `Runs \`${bin} <args>\` directly (no shell). Try a quick command below.` }]);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  useEffect(() => outRef.current?.scrollTo({ top: outRef.current.scrollHeight }), [lines]);

  async function run(args: string) {
    if (busy) return;
    setBusy(true);
    setLines((l) => [...l, { kind: "cmd", text: `$ ${bin} ${args}` }]);
    try {
      const r = await api<{ stdout: string; stderr: string; code: number | null; ms: number; error?: string }>(`/api/agents/${agent}/run`, {
        method: "POST",
        json: { args },
      });
      setLines((l) => [
        ...l,
        ...(r.stdout ? [{ kind: "out" as const, text: r.stdout.trimEnd() }] : []),
        ...(r.stderr ? [{ kind: "err" as const, text: r.stderr.trimEnd() }] : []),
        ...(r.error ? [{ kind: "err" as const, text: r.error }] : []),
        { kind: "out", text: `[exit ${r.code ?? "–"} · ${r.ms}ms]` },
      ]);
    } catch (e) {
      setLines((l) => [...l, { kind: "err", text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console">
      <div className="console-out" ref={outRef}>
        {lines.map((l, i) => (
          <div key={i} className={l.kind === "cmd" ? "cmd" : l.kind === "err" ? "stderr" : ""}>
            {l.text}
          </div>
        ))}
        {busy && <Spinner size={14} />}
      </div>
      <form
        className="console-in"
        onSubmit={(e) => {
          e.preventDefault();
          if (cmd.trim()) run(cmd.trim());
          setCmd("");
        }}
      >
        <span className="faint">{bin}</span>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="arguments…" disabled={busy} aria-label="Command arguments" />
        {QUICK[agent].map((q) => (
          <button type="button" key={q} className="btn sm" onClick={() => run(q)} disabled={busy}>
            {q}
          </button>
        ))}
      </form>
    </div>
  );
}

function Kanban({ agent }: { agent: Agent }) {
  const toast = useToast();
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [text, setText] = useState("");
  const load = () => api<KanbanCard[]>(`/api/kanban?agent=${agent}`).then(setCards).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const move = async (id: string, column: KanbanCard["column"]) => {
    await api("/api/kanban", { method: "PATCH", json: { id, column } });
    load();
  };
  const run = async (id: string) => {
    try {
      await api("/api/kanban", { method: "POST", json: { run: id } });
      load();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const del = async (id: string) => {
    await api(`/api/kanban?id=${id}`, { method: "DELETE" });
    load();
  };

  const cols: { id: KanbanCard["column"]; label: string }[] = [
    { id: "todo", label: "To do" },
    { id: "doing", label: "Doing" },
    { id: "done", label: "Done" },
  ];
  return (
    <>
      <form
        className="row"
        style={{ marginBottom: 14 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          await api("/api/kanban", { method: "POST", json: { agent, text } });
          setText("");
          load();
        }}
      >
        <input className="input" placeholder="Add a task for this agent… (▶ runs it with memory)" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn" type="submit">
          <Plus size={15} /> Add
        </button>
      </form>
      <div className="kanban">
        {cols.map((c) => (
          <div className="kcol" key={c.id}>
            <div className="eyebrow">
              {c.label} · {cards.filter((k) => k.column === c.id).length}
            </div>
            {cards
              .filter((k) => k.column === c.id)
              .map((k) => (
                <div className="kcard" key={k.id}>
                  <div>{k.text}</div>
                  <div className="row" style={{ marginTop: 8, gap: 6 }}>
                    <span className="faint mono" style={{ fontSize: 11 }}>
                      {timeAgo(k.createdAt)}
                    </span>
                    <span className="spacer" />
                    {c.id === "doing" && <Spinner size={13} />}
                    {c.id !== "doing" && (
                      <button className="btn sm ghost" title="Run with agent" onClick={() => run(k.id)}>
                        <Play size={13} />
                      </button>
                    )}
                    {c.id === "todo" && (
                      <button className="btn sm ghost" title="Mark done" onClick={() => move(k.id, "done")}>
                        ✓
                      </button>
                    )}
                    {c.id === "done" && (
                      <button className="btn sm ghost" title="Back to to-do" onClick={() => move(k.id, "todo")}>
                        ↺
                      </button>
                    )}
                    <button className="btn sm ghost danger" title="Delete" onClick={() => del(k.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {k.result && (
                    <div className={`res ${k.error ? "err" : ""}`}>
                      <Markdown>{k.result}</Markdown>
                    </div>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function ControlRoom({ agent }: { agent: Agent }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setInfo(await api<Info>(`/api/agents/${agent}/info`));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  const st = info?.status;
  return (
    <div>
      <div className="grid cols-3">
        <div className="card tight">
          <div className="row between">
            <span className="eyebrow">Status</span>
            <LivePill online={st ? st.online : null} />
          </div>
          <div className="mono" style={{ fontSize: 20, margin: "10px 0 4px" }}>
            {st ? (st.online ? "ONLINE" : st.enabled ? "OFFLINE" : "DISABLED") : "…"}
          </div>
          <div className="muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
            {st?.error || st?.detail || ""}
          </div>
        </div>
        <div className="card tight">
          <span className="eyebrow">Version · latency</span>
          <div className="mono" style={{ fontSize: 16, margin: "10px 0 4px" }}>
            {st?.version || "—"}
          </div>
          <div className="muted mono" style={{ fontSize: 13 }}>
            {st?.latencyMs !== undefined ? `${st.latencyMs}ms` : "—"}
          </div>
        </div>
        <div className="card tight">
          <div className="row between">
            <span className="eyebrow">{agent === "openclaw" ? "Agents · sessions" : agent === "hermes" ? "Model · sessions" : "Working dir"}</span>
            <button className="btn sm ghost" onClick={load} aria-label="Refresh">
              {loading ? <Spinner size={13} /> : <RefreshCw size={13} />}
            </button>
          </div>
          <div className="mono" style={{ fontSize: 15, margin: "10px 0 4px", overflowWrap: "anywhere" }}>
            {agent === "openclaw"
              ? `${info?.agents?.length ?? 0} agents · ${info?.sessions ?? 0} sessions`
              : agent === "hermes"
                ? [info?.model, info?.provider].filter(Boolean).join(" · ") || "model unknown"
                : info?.cwd || "—"}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {agent === "hermes" ? `${info?.sessions ?? 0} sessions on disk` : agent === "openclaw" ? info?.agents?.join(", ") || "no agents found" : "Claude Code runs here"}
          </div>
        </div>
      </div>

      {agent === "hermes" && (
        <>
          <SectionTitle icon={Wand2} title="Skills" meta={`${info?.skills?.length ?? 0} installed`} />
          {info?.skills?.length ? (
            <div className="grid cols-auto">
              {info.skills.map((s) => (
                <div className="card tight" key={s.name + s.category}>
                  <div className="row between">
                    <strong style={{ fontWeight: 500 }}>{s.name}</strong>
                    {s.category && <span className="badge">{s.category}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                    {s.description}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No skills found">Skills are read from the <code>skills/</code> folder in your Hermes home (Settings → Agents).</Empty>
          )}
        </>
      )}

      <SectionTitle icon={KanbanSquare} title="Kanban" meta="Tasks for this agent" />
      <Kanban agent={agent} />

      <SectionTitle icon={Terminal} title="Console" meta={info?.bin || ""} />
      {info?.bin ? <Console agent={agent} bin={info.bin} /> : <Empty title="No CLI configured" />}

      <SectionTitle icon={Cpu} title="Raw status" />
      <pre className="console console-out" style={{ minHeight: 0 }}>
        {JSON.stringify(st, null, 2)}
      </pre>
    </div>
  );
}
