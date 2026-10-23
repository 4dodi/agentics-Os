"use client";

import { useEffect, useState } from "react";
import { BookmarkPlus, Clock, Download, Image as ImageIcon, Mic2, Play, Sparkles, Trash2, Video } from "lucide-react";
import type { Settings, StudioItem } from "@/lib/types";
import { api, fmtDuration, mediaUrl } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { MicButton } from "@/components/MicButton";
import { Empty, Spinner, Tabs, useToast } from "@/components/ui";

type Kind = StudioItem["kind"];
const COPY: Record<Kind, { title: string; placeholder: string; note: (p: string) => string }> = {
  image: { title: "Generate image", placeholder: "A silver tabby cat on a neon-lit rooftop, cinematic, 35mm…", note: (p) => `image_gen via ${p}` },
  video: { title: "Generate video", placeholder: "Slow zoom into a neon-lit cyberpunk city street at night, rain reflections, 4 seconds…", note: (p) => `video_gen via ${p} · slow, can take 30s–2min` },
  speech: { title: "Generate speech", placeholder: "Text to speak — e.g. a 20-second intro for today's video…", note: (p) => `text_to_speech via ${p}` },
};

function ItemCard({ item, onChange }: { item: StudioItem; onChange: () => void }) {
  const toast = useToast();
  return (
    <div className="card media-card">
      <div className={`frame ${item.kind === "speech" ? "audio" : ""}`}>
        {item.status === "running" && (
          <div className="stack" style={{ alignItems: "center", padding: 30 }}>
            <Spinner size={22} />
            <span className="muted" style={{ fontSize: 13 }}>Generating with {item.provider}…</span>
          </div>
        )}
        {item.status === "error" && <div className="err" style={{ padding: 18, fontSize: 13, overflowWrap: "anywhere", maxHeight: 200, overflow: "auto" }}>{item.error}</div>}
        {item.status === "done" && item.file && (
          <>
            {item.kind === "image" && <img src={mediaUrl(item.file)} alt={item.prompt} />}
            {item.kind === "video" && <video src={mediaUrl(item.file)} controls preload="metadata" />}
            {item.kind === "speech" && <audio src={mediaUrl(item.file)} controls preload="metadata" />}
          </>
        )}
      </div>
      <div className="body">
        <div className="prompt" title={item.prompt}>{item.prompt}</div>
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <span className="faint mono row" style={{ fontSize: 11.5, gap: 5 }}>
            <Clock size={12} /> {new Date(item.createdAt).toLocaleTimeString([], { hour12: false })}
            {item.ms !== undefined && ` · ${fmtDuration(item.ms)}`}
          </span>
          <span className="spacer" />
          {item.status === "done" && item.file && (
            <>
              <a className="btn sm ghost" href={mediaUrl(item.file, true)} title="Download">
                <Download size={13} /> Save
              </a>
              <button
                className="btn sm ghost"
                title="Copy into your vault with a note"
                onClick={async () => {
                  try {
                    const r = await api<{ note: string }>("/api/studio", { method: "POST", json: { action: "vault", id: item.id } });
                    toast(`Saved to vault: ${r.note}`);
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                <BookmarkPlus size={13} /> Vault
              </button>
            </>
          )}
          <button
            className="btn sm ghost danger"
            aria-label="Remove"
            onClick={async () => {
              await api(`/api/studio?id=${item.id}`, { method: "DELETE" });
              onChange();
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudioPage() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("image");
  const [items, setItems] = useState<StudioItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<StudioItem[]>("/api/studio").then(setItems).catch(() => {});
  useEffect(() => {
    load();
    api<Settings>("/api/settings").then(setSettings).catch(() => {});
  }, []);
  const running = items.some((i) => i.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [running]);

  const provider = settings ? (kind === "image" ? settings.studio.imageProvider : kind === "video" ? settings.studio.videoProvider : settings.studio.speechProvider) : "…";
  const shown = items.filter((i) => i.kind === kind);
  const count = (k: Kind) => items.filter((i) => i.kind === k).length;

  async function generate() {
    setBusy(true);
    try {
      await api("/api/studio", { method: "POST", json: { kind, prompt } });
      setPrompt("");
      load();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Studio" subtitle="Generate images, videos and speech with your agents. Voice in, preview inline, save to vault." />
      <div className="row between wrap">
        <Tabs
          value={kind}
          onChange={setKind}
          tabs={[
            { id: "image", label: "Images", icon: ImageIcon, count: count("image") },
            { id: "video", label: "Videos", icon: Video, count: count("video") },
            { id: "speech", label: "Speech", icon: Mic2, count: count("speech") },
          ]}
        />
        <button
          className="link-btn"
          style={{ marginBottom: 24 }}
          disabled={!shown.length}
          onClick={async () => {
            if (!confirm(`Clear all ${kind} items? Files on disk are kept.`)) return;
            await api(`/api/studio?kind=${kind}`, { method: "DELETE" });
            load();
          }}
        >
          <Trash2 size={13} /> Clear all
        </button>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <Sparkles size={18} color="var(--accent)" />
          <h3>{COPY[kind].title}</h3>
        </div>
        <div className="row" style={{ alignItems: "stretch" }}>
          <MicButton onText={(t) => setPrompt((v) => (v ? `${v} ${t}` : t))} />
          <textarea
            className="textarea"
            rows={3}
            placeholder={COPY[kind].placeholder}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) generate();
            }}
          />
          <button className="btn primary" disabled={busy || !prompt.trim()} onClick={generate} style={{ minWidth: 130 }}>
            {busy ? <Spinner /> : <Play size={15} />} Generate
          </button>
        </div>
        <div className="eyebrow" style={{ marginTop: 12, fontSize: 11 }}>{COPY[kind].note(provider)}</div>
      </div>

      <div style={{ marginTop: 20 }}>
        {shown.length ? (
          <div className="media-grid">
            {shown.map((i) => (
              <ItemCard key={i.id} item={i} onChange={load} />
            ))}
          </div>
        ) : (
          <Empty title={`No ${kind === "speech" ? "speech" : `${kind}s`} yet`}>
            Uses <strong>{provider}</strong>. Agents save the file and reply with its path; change providers in Settings → Studio.
          </Empty>
        )}
      </div>
    </>
  );
}
