"use client";

import { useEffect, useMemo, useState } from "react";
import { Brain, Eye, Rocket, Sparkles } from "lucide-react";
import type { AgentId, SeoSession, Settings } from "@/lib/types";
import { api, fmtDuration } from "@/lib/client";
import { useStatus } from "@/components/StatusProvider";
import { Spinner, useToast } from "@/components/ui";
import { MicButton } from "@/components/MicButton";
import { NoSites, type SeoData } from "./SeoPage";

const ENGINES: { id: AgentId; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "hermes", label: "Hermes" },
  { id: "openclaw", label: "OpenClaw" },
  { id: "api", label: "API (OpenAI-compatible)" },
];

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function SessionProgress({ session, goDeploy }: { session: SeoSession; goDeploy?: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (session.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session.status]);
  const done = session.articles.filter((a) => a.status === "done").length;
  return (
    <div className="card glow" style={{ marginTop: 18 }}>
      <div className="row between wrap">
        <div>
          <div className="eyebrow">{session.status === "running" ? "Writing" : session.status} · {fmtDuration(session.ms ?? now - session.startedAt)}</div>
          <h3 style={{ marginTop: 6 }}>{session.keyword}</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            slug: {session.slug} · transcript: {session.transcriptLabel} · engine: {session.engine}
          </div>
        </div>
        <span className={`pill ${session.status === "done" ? "okb" : session.status === "running" ? "warn" : session.status === "partial" ? "warn" : "off"}`}>
          {done} of {session.articles.length} written
        </span>
      </div>
      <div className="progress" style={{ margin: "16px 0" }}>
        <i style={{ width: `${(done / session.articles.length) * 100}%` }} />
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {session.articles.map((a) => (
          <div key={a.siteId} className="row" style={{ gap: 12, minWidth: 0 }}>
            <span className="sdot" style={{ ["--c" as string]: a.color }} />
            <span className="mono" style={{ width: 230, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.domain}</span>
            {a.status === "pending" && <span className="faint">queued</span>}
            {a.status === "writing" && (
              <span className="row muted">
                <Spinner size={14} /> writing… {a.chars ? `${a.chars.toLocaleString()} chars` : ""}
              </span>
            )}
            {a.status === "done" && (
              <span className="row" style={{ minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                <span className="faint mono" style={{ fontSize: 12, flex: "none" }}>{a.words} words</span>
                <a className="btn sm ghost" href={`/api/seo/preview?site=${encodeURIComponent(a.siteId)}&slug=${encodeURIComponent(session.slug)}`} target="_blank" rel="noreferrer">
                  <Eye size={13} /> Preview
                </a>
              </span>
            )}
            {a.status === "error" && <span className="err" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{a.error}</span>}
          </div>
        ))}
      </div>
      {session.status !== "running" && done > 0 && goDeploy && (
        <button className="btn primary" style={{ marginTop: 18 }} onClick={goDeploy}>
          <Rocket size={15} /> Review & deploy
        </button>
      )}
    </div>
  );
}

export function GenerateTab({ data, goDeploy, preselect }: { data: SeoData; goDeploy: () => void; preselect?: string }) {
  const toast = useToast();
  const { status } = useStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyword, setKeyword] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [source, setSource] = useState<string>(preselect || "paste");
  const [pasted, setPasted] = useState("");
  const [engine, setEngine] = useState<AgentId>("claude");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [useMemory, setUseMemory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<SeoSession | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then((s) => {
      setSettings(s);
      setEngine(s.seo.engine);
      setUseMemory(s.seo.useMemory);
      setSiteIds(s.seo.sites.filter((x) => x.enabled).map((x) => x.id));
    });
  }, []);
  useEffect(() => {
    if (preselect) setSource(preselect);
  }, [preselect]);

  // Resume watching a running session after navigation.
  useEffect(() => {
    if (!activeId) {
      const running = data.sessions.find((s) => s.status === "running");
      if (running) setActiveId(running.id);
    }
  }, [data.sessions, activeId]);

  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    const poll = async () => {
      try {
        const s = await api<SeoSession>(`/api/seo/sessions?id=${activeId}`);
        if (stop) return;
        setActive(s);
        if (s.status !== "running") {
          data.reload();
          return;
        }
      } catch {
        /* retry */
      }
      if (!stop) setTimeout(poll, 1500);
    };
    poll();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const effectiveSlug = slugTouched ? slug : slugify(keyword);
  const sites = settings?.seo.sites ?? [];
  const transcript = useMemo(() => data.transcripts.find((t) => t.id === source), [data.transcripts, source]);
  const running = active?.status === "running";

  async function generate() {
    setBusy(true);
    try {
      const s = await api<SeoSession>("/api/seo/sessions", {
        method: "POST",
        json: {
          keyword,
          slug: effectiveSlug,
          engine,
          siteIds,
          useMemory,
          ...(source === "paste" ? { transcriptText: pasted } : source === "none" ? {} : { transcriptId: source }),
        },
      });
      setActive(s);
      setActiveId(s.id);
      data.reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  if (settings && !sites.length) return <NoSites />;

  return (
    <>
      <div className="card">
        <div className="grid cols-2">
          <label className="field">
            Target keyword
            <input className="input" placeholder="e.g. pi vs openclaw" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </label>
          <label className="field">
            Slug
            <input
              className="input mono"
              value={effectiveSlug}
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
            />
            <span className="hint">Every site publishes at /blog/{effectiveSlug || "…"}/</span>
          </label>
        </div>

        <div className="grid cols-2" style={{ marginTop: 16 }}>
          <label className="field">
            Transcript / case study
            <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="paste">Paste text…</option>
              <option value="none">No transcript (general knowledge)</option>
              {data.transcripts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.words.toLocaleString()} words
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Engine
            <select className="select" value={engine} onChange={(e) => setEngine(e.target.value as AgentId)}>
              {ENGINES.map((en) => (
                <option key={en.id} value={en.id}>
                  {en.label} {status ? (status.agents[en.id].online ? "● online" : "○ offline") : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {source === "paste" && (
          <div style={{ marginTop: 16 }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <textarea
                className="textarea"
                rows={7}
                placeholder="Paste a YouTube transcript, case study or notes. Timestamps are stripped automatically."
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <MicButton onText={(t) => setPasted((v) => (v ? `${v} ${t}` : t))} />
            </div>
          </div>
        )}
        {transcript && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {transcript.text.slice(0, 280)}…
          </p>
        )}

        <div style={{ marginTop: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Sites · one unique article each</div>
          <div className="row wrap" style={{ gap: 14 }}>
            {sites.map((s) => (
              <label key={s.id} className="check" title={s.angle || "default angle"}>
                <input
                  type="checkbox"
                  checked={siteIds.includes(s.id)}
                  onChange={(e) => setSiteIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((i) => i !== s.id)))}
                />
                <span className="sdot" style={{ ["--c" as string]: s.color }} /> {s.domain}
              </label>
            ))}
          </div>
        </div>

        <div className="row wrap" style={{ marginTop: 20 }}>
          <label className="check">
            <input type="checkbox" checked={useMemory} onChange={(e) => setUseMemory(e.target.checked)} />
            <Brain size={14} /> Personalise with memory (vault profile + related notes)
          </label>
          <span className="spacer" />
          <button className="btn primary" disabled={busy || running || !keyword.trim() || !siteIds.length || (source === "paste" && !pasted.trim())} onClick={generate}>
            {busy ? <Spinner /> : <Sparkles size={16} />} Generate {siteIds.length} article{siteIds.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      {active && <SessionProgress session={active} goDeploy={goDeploy} />}
    </>
  );
}
