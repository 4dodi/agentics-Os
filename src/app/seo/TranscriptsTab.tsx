"use client";

import { useState } from "react";
import { Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { Empty, useToast } from "@/components/ui";
import type { SeoData } from "./SeoPage";

export function TranscriptsTab({ data, use }: { data: SeoData; use: (id: string) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  async function add() {
    try {
      await api("/api/seo/transcripts", { method: "POST", json: { title, text } });
      setTitle("");
      setText("");
      data.reload();
      toast("Transcript saved");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="input" placeholder="Title (e.g. Hermes Agent OS livestream)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="btn">
            <Upload size={15} /> Upload
            <input
              type="file"
              accept=".txt,.md,.srt,.vtt"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setText(await f.text());
                if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </label>
        </div>
        <textarea className="textarea" rows={6} placeholder="Paste a transcript or case study (.srt/.vtt timestamps are cleaned up)" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button className="btn primary" disabled={!text.trim()} onClick={add}>
            <Plus size={15} /> Save transcript
          </button>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 18 }}>
        {data.transcripts.map((t) => (
          <div className="card tight" key={t.id}>
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontWeight: 500 }}>{t.title}</strong>
                <div className="faint mono" style={{ fontSize: 11.5 }}>
                  {t.words.toLocaleString()} words · {timeAgo(t.createdAt)}
                </div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => use(t.id)}>
                  <Sparkles size={13} /> Use
                </button>
                <button
                  className="btn sm ghost danger"
                  aria-label="Delete transcript"
                  onClick={async () => {
                    if (!confirm(`Delete “${t.title}”?`)) return;
                    await api(`/api/seo/transcripts?id=${t.id}`, { method: "DELETE" });
                    data.reload();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{t.text.slice(0, 260)}…</p>
          </div>
        ))}
        {!data.transcripts.length && <Empty title="No saved transcripts">Save your case studies once and reuse them for many keywords.</Empty>}
      </div>
    </>
  );
}
