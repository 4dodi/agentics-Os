"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brain, Copy, Send, Square, Wrench } from "lucide-react";
import type { AgentId, ChatMessage, ChatThread } from "@/lib/types";
import { AGENT_META } from "@/lib/nav";
import { api, fmtDuration, mediaUrl, streamNdjson } from "@/lib/client";
import { AgentAvatar } from "./icons";
import { Markdown } from "./Markdown";
import { MicButton } from "./MicButton";
import { handoff } from "./CommandPalette";
import { useToast } from "./ui";

type Agent = Exclude<AgentId, "api">;
const MEDIA_RE = /(?:[?&]path=([^\s&"'`)\]]+))|((?:https?:\/\/|\/|~\/)[^\s"'`<>()\]]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|ogg|m4a))(?=$|[\s"'`<>)\],;:!?])/gim;

/** Media files mentioned in a reply, as URLs we can preview. */
function mediaIn(text: string): { url: string; kind: "image" | "video" | "audio" }[] {
  const out = new Map<string, "image" | "video" | "audio">();
  for (const m of text.matchAll(MEDIA_RE)) {
    let ref = m[1] ? safeDecode(m[1]) : m[2];
    if (!ref) continue;
    ref = ref.replace(/[.,]$/, "");
    const ext = ref.split(".").pop()!.toLowerCase();
    const kind = /mp4|webm|mov|m4v/.test(ext) ? "video" : /mp3|wav|ogg|m4a/.test(ext) ? "audio" : /png|jpe?g|webp|gif/.test(ext) ? "image" : null;
    if (!kind) continue;
    out.set(/^https?:/.test(ref) && !ref.includes("/api/media/") ? ref : mediaUrl(ref), kind);
  }
  return [...out].slice(0, 4).map(([url, kind]) => ({ url, kind }));
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function Media({ text }: { text: string }) {
  const items = mediaIn(text);
  if (!items.length) return null;
  return (
    <>
      {items.map((m) => (
        <div className="media-preview" key={m.url}>
          {m.kind === "image" && <img src={m.url} alt="" />}
          {m.kind === "video" && <video src={m.url} controls preload="metadata" />}
          {m.kind === "audio" && <audio src={m.url} controls preload="metadata" />}
        </div>
      ))}
    </>
  );
}

export function ChatPanel({ agent }: { agent: Agent }) {
  const meta = AGENT_META[agent];
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ text: string; tools: string[]; memory?: string[] } | null>(null);
  const [useMemory, setUseMemory] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(`memory:${agent}`);
      if (m !== null) setUseMemory(m === "1");
    } catch {
      /* storage unavailable */
    }
    api<ChatThread>(`/api/agents/${agent}/chat`).then((t) => setMessages(t.messages)).catch(() => {});
  }, [agent]);

  // Hand-offs from the command palette or another agent's reply.
  useEffect(() => {
    if (autoSent.current) return;
    try {
      const text = sessionStorage.getItem(`handoff:${agent}`);
      const auto = sessionStorage.getItem(`autosend:${agent}`);
      sessionStorage.removeItem(`handoff:${agent}`);
      sessionStorage.removeItem(`autosend:${agent}`);
      if (text) {
        autoSent.current = true;
        if (auto) void send(text);
        else setInput(text);
      }
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, live?.text]);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setLive({ text: "", tools: [] });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      await streamNdjson(
        `/api/agents/${agent}/chat`,
        { message: text, useMemory },
        (ev) => {
          if (ev.type === "user") setMessages((m) => [...m, ev.message]);
          else if (ev.type === "memory") setLive((l) => l && { ...l, memory: ev.sources });
          else if (ev.type === "delta") setLive((l) => l && { ...l, text: l.text + ev.text });
          else if (ev.type === "tool") setLive((l) => l && { ...l, tools: [...l.tools, ev.name] });
          else if (ev.type === "done") setLive((l) => l && { ...l, text: ev.text || l.text });
          else if (ev.type === "saved") {
            setMessages((m) => [...m, ev.message]);
            setLive(null);
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, true);
      // Reload shortly after, so the partial turn the server saved on abort shows up.
      setTimeout(() => api<ChatThread>(`/api/agents/${agent}/chat`).then((t) => setMessages(t.messages)).catch(() => {}), 700);
    } finally {
      setLive(null);
      setBusy(false);
      abort.current = null;
    }
  }

  async function clear() {
    if (!confirm(`Clear the ${meta.label} conversation? This also starts a new agent session.`)) return;
    await api(`/api/agents/${agent}/chat`, { method: "DELETE" });
    setMessages([]);
  }

  const others = (Object.keys(AGENT_META) as Agent[]).filter((a) => a !== agent);

  return (
    <div className="card chat" style={{ ["--accent" as string]: meta.accent }}>
      <div className="chat-head">
        <AgentAvatar id={agent} />
        <span className="who">{meta.label}</span>
        <span className="spacer" />
        <label className="check" title="Inject your pinned profile notes + relevant vault notes into the prompt">
          <input
            type="checkbox"
            checked={useMemory}
            onChange={(e) => {
              setUseMemory(e.target.checked);
              try {
                localStorage.setItem(`memory:${agent}`, e.target.checked ? "1" : "0");
              } catch {
                /* storage unavailable */
              }
            }}
          />
          <Brain size={14} /> Memory
        </label>
        <button className="link-btn" onClick={clear} disabled={busy}>
          Clear
        </button>
      </div>

      <div className="chat-log" ref={logRef}>
        {!messages.length && !live && (
          <div className="empty" style={{ margin: "auto", maxWidth: 520 }}>
            <h3>Start a conversation with {meta.label}</h3>
            <p style={{ margin: 0 }}>{meta.blurb} Memory is {useMemory ? "on" : "off"}: your vault profile is {useMemory ? "" : "not "}sent as context.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.role === "assistant" && <AgentAvatar id={agent} />}
            <div style={{ minWidth: 0 }}>
              <div className="bubble">{m.role === "assistant" ? <Markdown>{m.content}</Markdown> : m.content}</div>
              {m.role === "assistant" && <Media text={m.content} />}
              <div className="msg-meta" style={{ justifyContent: m.role === "user" ? "flex-end" : undefined }}>
                <span>{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                {m.ms !== undefined && <span>{fmtDuration(m.ms)}</span>}
                {m.memory && <span title="Sent with memory context">◆ memory</span>}
                {m.tools?.map((t) => (
                  <span key={t} className="tool-chip">
                    {t}
                  </span>
                ))}
                {m.role === "assistant" && (
                  <>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(m.content);
                        toast("Copied");
                      }}
                      title="Copy"
                    >
                      <Copy size={12} />
                    </button>
                    {others.map((a) => (
                      <button
                        key={a}
                        title={`Hand this reply to ${AGENT_META[a].label}`}
                        onClick={() => {
                          handoff(a, `From ${meta.label}:\n\n${m.content}\n\n`);
                          router.push(`/${a}`);
                        }}
                      >
                        → {AGENT_META[a].label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {live && (
          <div className="msg assistant">
            <AgentAvatar id={agent} />
            <div style={{ minWidth: 0 }}>
              <div className="bubble">
                {live.text ? (
                  <Markdown>{live.text}</Markdown>
                ) : (
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              <div className="msg-meta">
                {live.memory && <span>◆ memory: {live.memory.length ? live.memory.join(", ") : "no matching notes"}</span>}
                {[...new Set(live.tools)].map((t) => (
                  <span key={t} className="tool-chip">
                    <Wrench size={10} /> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <MicButton onText={(t) => setInput((v) => (v ? `${v} ${t}` : t))} disabled={busy} />
        <textarea
          className="textarea"
          placeholder={`Message ${meta.label}… (⌘+Enter)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            <Square size={15} /> Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!input.trim()}>
            <Send size={15} /> Send
          </button>
        )}
      </form>
    </div>
  );
}
