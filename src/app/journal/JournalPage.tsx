"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Pencil, Save, Send, Sparkles, Activity } from "lucide-react";
import type { ActivityItem, AgentId } from "@/lib/types";
import { api, localDate } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { Markdown } from "@/components/Markdown";
import { MicButton } from "@/components/MicButton";
import { Empty, SectionTitle, Spinner, useToast } from "@/components/ui";

interface Day {
  date: string;
  exists: boolean;
  content: string;
  dates: string[];
  activity: ActivityItem[];
}

function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function JournalPage() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const today = localDate();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date")! : today;
  const [day, setDay] = useState<Day | null>(null);
  const [entry, setEntry] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [reflecting, setReflecting] = useState(false);
  const [agent, setAgent] = useState<AgentId>("claude");

  const load = () =>
    api<Day>(`/api/journal?date=${date}&tz=${new Date().getTimezoneOffset()}`)
      .then((d) => {
        setDay(d);
        setDraft(d.content);
      })
      .catch((e) => toast((e as Error).message, true));
  useEffect(() => {
    setEditing(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const go = (d: string) => router.replace(d === today ? "/journal" : `/journal?date=${d}`);

  async function append() {
    if (!entry.trim()) return;
    const time = new Date().toTimeString().slice(0, 5);
    const r = await api<{ content: string }>("/api/journal", { method: "POST", json: { date, text: entry, time } });
    setEntry("");
    setDay((d) => d && { ...d, content: r.content, exists: true });
    setDraft(r.content);
  }

  const label = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <PageHeader title="Journal" subtitle={<>Daily notes saved to your vault as <code className="mono">Journal/{date}.md</code> — agents read them as memory.</>} />
      <div className="row wrap" style={{ marginBottom: 18 }}>
        <button className="btn icon" onClick={() => go(shift(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
        <button className="btn icon" onClick={() => go(shift(date, 1))} disabled={date >= today} aria-label="Next day"><ChevronRight size={16} /></button>
        <h2 style={{ margin: "0 8px", fontWeight: 500, fontSize: 22 }}>{label}</h2>
        {date !== today && <button className="btn sm" onClick={() => go(today)}>Today</button>}
        <span className="spacer" />
        <input type="date" className="input" style={{ width: 180 }} value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Pick a date" />
      </div>

      <div className="split">
        <div className="stack">
          <form
            className="card tight row"
            onSubmit={(e) => {
              e.preventDefault();
              append();
            }}
          >
            <MicButton onText={(t) => setEntry((v) => (v ? `${v} ${t}` : t))} />
            <input className="input" placeholder="Log something — a win, an idea, what you shipped…" value={entry} onChange={(e) => setEntry(e.target.value)} />
            <button className="btn primary" type="submit" disabled={!entry.trim()}><Send size={15} /> Log</button>
          </form>

          <div className="card">
            <div className="row between" style={{ marginBottom: 14 }}>
              <span className="eyebrow">{day?.exists ? "Saved in vault" : "New page"}</span>
              <div className="row">
                {editing ? (
                  <button
                    className="btn sm primary"
                    onClick={async () => {
                      await api("/api/journal", { method: "PUT", json: { date, content: draft } });
                      setDay((d) => d && { ...d, content: draft, exists: true });
                      setEditing(false);
                      toast("Saved");
                    }}
                  >
                    <Save size={13} /> Save
                  </button>
                ) : null}
                <button className="btn sm" onClick={() => setEditing((e) => !e)}>
                  {editing ? <><Eye size={13} /> View</> : <><Pencil size={13} /> Edit</>}
                </button>
              </div>
            </div>
            {!day ? (
              <Spinner />
            ) : editing ? (
              <textarea className="textarea mono" style={{ minHeight: 420, fontSize: 13.5 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
            ) : (
              <Markdown>{day.content}</Markdown>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <Sparkles size={16} color="var(--accent)" />
              <h3>Reflect</h3>
            </div>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
              An agent reads today&apos;s page plus everything your agents did and appends a short reflection.
            </p>
            <div className="row">
              <select className="select" value={agent} onChange={(e) => setAgent(e.target.value as AgentId)} style={{ padding: "8px 30px 8px 12px" }}>
                <option value="claude">Claude</option>
                <option value="hermes">Hermes</option>
                <option value="openclaw">OpenClaw</option>
                <option value="api">API</option>
              </select>
              <button
                className="btn"
                disabled={reflecting}
                onClick={async () => {
                  setReflecting(true);
                  try {
                    const r = await api<{ content: string }>("/api/journal", { method: "POST", json: { date, action: "reflect", agent, tz: new Date().getTimezoneOffset() } });
                    setDay((d) => d && { ...d, content: r.content, exists: true });
                    setDraft(r.content);
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setReflecting(false);
                  }
                }}
              >
                {reflecting ? <Spinner size={14} /> : <Sparkles size={14} />} Reflect
              </button>
            </div>
          </div>

          <div>
            <SectionTitle icon={Activity} title="Agent activity" meta={`${day?.activity.length ?? 0} events`} />
            <div className="card tight">
              {day?.activity.length ? (
                <div className="feed">
                  {day.activity.map((a) => (
                    <Link key={a.id} href={a.href || "#"} className="feed-item" style={{ ["--c" as string]: a.ok === false ? "var(--err)" : "var(--accent)", gridTemplateColumns: "14px 1fr auto" }}>
                      <span className="d" />
                      <span className="t" title={a.title}>{a.title}</span>
                      <span className="when">{new Date(a.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty title="Quiet day" />
              )}
            </div>
          </div>

          {!!day?.dates.length && (
            <div>
              <SectionTitle title="Recent pages" />
              <div className="row wrap" style={{ gap: 6 }}>
                {day.dates.slice(0, 21).map((d) => (
                  <button key={d} className={`btn sm ${d === date ? "primary" : ""}`} onClick={() => go(d)}>{d.slice(5)}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
