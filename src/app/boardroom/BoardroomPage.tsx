"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Copy, Gavel, Globe, History, Send, Square, Trash2, Users } from "lucide-react";
import type { AgentId, BoardroomReply, BoardroomSession } from "@/lib/types";
import { AGENT_META } from "@/lib/nav";
import { api, fmtDuration, streamNdjson, timeAgo } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { AgentAvatar } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { MicButton } from "@/components/MicButton";
import { useStatus } from "@/components/StatusProvider";
import { Empty, SectionTitle, Spinner, useToast } from "@/components/ui";

const MEMBERS: AgentId[] = ["claude", "hermes", "openclaw", "api"];
const NAME: Record<AgentId, string> = { claude: "Claude", hermes: "Hermes", openclaw: "OpenClaw", api: "API" };
const ACCENT: Record<AgentId, string> = { ...Object.fromEntries(Object.entries(AGENT_META).map(([k, v]) => [k, v.accent])), api: "#94a3b8" } as Record<AgentId, string>;

function Avatar({ id }: { id: AgentId }) {
  if (id === "api")
    return (
      <span className="avatar" style={{ ["--c" as string]: ACCENT.api }}>
        <Globe size={15} />
      </span>
    );
  return <AgentAvatar id={id} />;
}

function ReplyCard({ reply, title }: { reply: BoardroomReply; title?: string }) {
  const toast = useToast();
  return (
    <div className="card board-reply" style={{ ["--accent" as string]: ACCENT[reply.agent] }}>
      <div className="row" style={{ gap: 10 }}>
        <Avatar id={reply.agent} />
        <strong>{title ?? NAME[reply.agent]}</strong>
        <span className="spacer" />
        {reply.status === "running" ? (
          <span className="pill warn"><Spinner size={11} /> thinking</span>
        ) : reply.status === "error" ? (
          <span className="pill off">✗ error</span>
        ) : (
          <span className="faint mono" style={{ fontSize: 11.5 }}>{fmtDuration(reply.ms)}</span>
        )}
        {reply.text && (
          <button
            className="btn icon ghost sm"
            aria-label={`Copy ${NAME[reply.agent]}'s answer`}
            onClick={() => navigator.clipboard.writeText(reply.text).then(() => toast("Copied"), () => toast("Copy failed", true))}
          >
            <Copy size={13} />
          </button>
        )}
      </div>
      <div className="board-body">
        {reply.text ? <Markdown>{reply.text}</Markdown> : reply.status === "running" ? <span className="faint">Waiting for the first words…</span> : null}
        {reply.error && <div className="err" style={{ fontSize: 13, marginTop: 8 }}>{reply.error}</div>}
      </div>
    </div>
  );
}

function SessionView({ session }: { session: BoardroomSession }) {
  const n = session.replies.length;
  const cols = n === 4 ? 2 : Math.min(n, 3);
  return (
    <>
      <div className={`grid ${cols >= 3 ? "cols-3" : cols === 2 ? "cols-2" : ""}`}>
        {session.replies.map((r) => (
          <ReplyCard key={r.agent} reply={r} />
        ))}
      </div>
      {session.synthesis && (
        <div style={{ marginTop: 18 }}>
          <ReplyCard reply={session.synthesis} title={`Board recommendation · ${NAME[session.synthesis.agent]}`} />
        </div>
      )}
    </>
  );
}

export function BoardroomPage() {
  const toast = useToast();
  const { status } = useStatus();
  const [prompt, setPrompt] = useState("");
  const [members, setMembers] = useState<AgentId[]>(["claude", "hermes", "openclaw"]);
  const [synth, setSynth] = useState<AgentId | "">("claude");
  const [useMemory, setUseMemory] = useState(true);
  const [live, setLive] = useState<BoardroomSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<BoardroomSession[] | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const loadHistory = () => api<BoardroomSession[]>("/api/boardroom").then(setHistory).catch(() => setHistory([]));
  useEffect(() => {
    loadHistory();
    // Default to the members that are actually online, once status arrives.
  }, []);
  const statusReady = !!status;
  useEffect(() => {
    if (!status) return;
    const online = MEMBERS.filter((id) => status.agents[id]?.online);
    if (online.length) setMembers(online.slice(0, 4));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusReady]);

  const toggle = (id: AgentId) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : MEMBERS.filter((x) => x === id || m.includes(x))));

  async function ask() {
    const text = prompt.trim();
    if (!text || busy || !members.length) return;
    setBusy(true);
    setViewing(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const patchReply = (agent: AgentId, synthesis: boolean | undefined, fn: (r: BoardroomReply) => BoardroomReply) =>
      setLive((s) => {
        if (!s) return s;
        if (synthesis) return { ...s, synthesis: s.synthesis ? fn(s.synthesis) : s.synthesis };
        return { ...s, replies: s.replies.map((r) => (r.agent === agent ? fn(r) : r)) };
      });
    try {
      await streamNdjson(
        "/api/boardroom",
        { prompt: text, agents: members, synthesizer: synth || null, useMemory },
        (ev) => {
          if (ev.type === "start") setLive(ev.session);
          else if (ev.type === "delta") patchReply(ev.agent, ev.synthesis, (r) => ({ ...r, text: r.text + ev.text }));
          else if (ev.type === "reply") {
            if (ev.synthesis) setLive((s) => s && { ...s, synthesis: ev.reply });
            else patchReply(ev.reply.agent, false, () => ev.reply);
          } else if (ev.type === "saved") {
            setLive(ev.session);
            setPrompt("");
            loadHistory();
          } else if (ev.type === "error") toast(ev.message, true);
        },
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, true);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const shown = viewing ? history?.find((h) => h.id === viewing) ?? null : live;

  return (
    <>
      <PageHeader title="Boardroom" subtitle="Ask all your agents at once. Compare their answers side by side, then let one of them chair the board and write a recommendation." />

      <div className="card board-composer">
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <span className="eyebrow" style={{ marginRight: 4 }}>Members</span>
          {MEMBERS.map((id) => {
            const st = status?.agents[id];
            const on = members.includes(id);
            return (
              <button
                key={id}
                className={`member-chip ${on ? "on" : ""}`}
                style={{ ["--c" as string]: ACCENT[id] }}
                aria-pressed={on}
                onClick={() => toggle(id)}
                disabled={busy}
                title={st ? (st.online ? `${NAME[id]} is online` : `${NAME[id]}: ${st.error || "offline"}`) : NAME[id]}
              >
                <span className={`dot ${st?.online ? "on" : ""}`} />
                {NAME[id]}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
          <MicButton onText={(t) => setPrompt((p) => (p ? `${p} ${t}` : t))} disabled={busy} />
          <textarea
            className="textarea"
            rows={3}
            style={{ flex: 1 }}
            placeholder="e.g. Which automation should I build this week to grow my SEO sites fastest?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void ask();
              }
            }}
          />
        </div>
        <div className="row wrap" style={{ gap: 12, marginTop: 12 }}>
          <label className="row faint" style={{ gap: 8, fontSize: 13 }}>
            <Gavel size={14} /> Chair
            <select className="select sm" value={synth} onChange={(e) => setSynth(e.target.value as AgentId | "")} disabled={busy}>
              <option value="">No synthesis</option>
              {MEMBERS.map((id) => (
                <option key={id} value={id}>{NAME[id]}</option>
              ))}
            </select>
          </label>
          <label className="check" title="Send your pinned profile notes + relevant vault notes to every member">
            <input type="checkbox" checked={useMemory} onChange={(e) => setUseMemory(e.target.checked)} disabled={busy} />
            <Brain size={14} /> Memory
          </label>
          <span className="spacer" />
          {busy ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              <Square size={14} /> Stop
            </button>
          ) : (
            <button className="btn primary" onClick={ask} disabled={!prompt.trim() || !members.length}>
              <Send size={15} /> Ask the board
            </button>
          )}
        </div>
      </div>

      {shown && (
        <>
          <SectionTitle icon={Users} title={viewing ? "From history" : "This meeting"} meta={`${shown.replies.length} member${shown.replies.length === 1 ? "" : "s"}`}>
            {viewing && <button className="link-btn" onClick={() => setViewing(null)}>Close</button>}
          </SectionTitle>
          <div className="card tight board-question">{shown.prompt}</div>
          <SessionView session={shown} />
        </>
      )}

      <SectionTitle icon={History} title="Past meetings" meta={history ? `${history.length} saved` : undefined}>
        {!!history?.length && (
          <button
            className="link-btn"
            onClick={async () => {
              if (!confirm("Delete all past meetings?")) return;
              await api("/api/boardroom", { method: "DELETE" });
              setViewing(null);
              loadHistory();
            }}
          >
            Clear
          </button>
        )}
      </SectionTitle>
      {history === null ? (
        <Spinner />
      ) : history.length ? (
        <div className="stack" style={{ gap: 8 }}>
          {history.slice(0, 30).map((h) => (
            <div key={h.id} className={`card tight board-hist ${viewing === h.id ? "on" : ""}`}>
              <button className="board-hist-open" onClick={() => setViewing(h.id)}>
                <span className="q">{h.prompt}</span>
                <span className="faint mono" style={{ fontSize: 11.5 }}>
                  {timeAgo(h.ts)} · {h.replies.map((r) => NAME[r.agent]).join(", ")}
                  {h.synthesis ? ` · chaired by ${NAME[h.synthesis.agent]}` : ""}
                </span>
              </button>
              <button
                className="btn icon ghost danger sm"
                aria-label="Delete meeting"
                onClick={async () => {
                  await api(`/api/boardroom?id=${h.id}`, { method: "DELETE" });
                  if (viewing === h.id) setViewing(null);
                  loadHistory();
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No meetings yet">Ask a question above. Each member answers on its own; the chair then weighs the answers.</Empty>
      )}
    </>
  );
}
