"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Brain, Eye, FilePlus2, Link2, Pencil, Pin, PinOff, Save, Search, Trash2 } from "lucide-react";
import type { NoteMeta } from "@/lib/types";
import { api, mediaUrl, timeAgo } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { Markdown, wikilinksToMarkdown } from "@/components/Markdown";
import { Empty, SectionTitle, Spinner, useToast } from "@/components/ui";
import { OmiImport } from "./OmiImport";

interface Vault {
  root: string;
  notes: NoteMeta[];
  profileNotes: string[];
}
interface Note {
  path: string;
  content: string;
  links: { target: string; path: string | null }[];
  backlinks: NoteMeta[];
}
type Hit = NoteMeta & { snippet: string; score: number };

export function MemoryPage() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("note");
  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultErr, setVaultErr] = useState<string | null>(null);
  const [q, setQ] = useState(params.get("q") || "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<{ text: string; sources: string[] } | null>(null);
  const [probe, setProbe] = useState("");

  const loadVault = () =>
    api<Vault>("/api/memory")
      .then((v) => {
        setVault(v);
        setVaultErr(null);
      })
      .catch((e) => setVaultErr((e as Error).message));
  useEffect(() => {
    loadVault();
  }, []);

  const open = (path: string | null) => router.replace(path ? `/memory?note=${encodeURIComponent(path)}` : "/memory");

  useEffect(() => {
    setEditing(false);
    if (!selected) {
      setNote(null);
      return;
    }
    api<Note>(`/api/memory?path=${encodeURIComponent(selected)}`)
      .then((n) => {
        setNote(n);
        setDraft(n.content);
      })
      .catch((e) => toast((e as Error).message, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Full-text search for longer queries; title filter otherwise.
  useEffect(() => {
    if (q.trim().length < 3) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => api<Hit[]>(`/api/memory?q=${encodeURIComponent(q)}`).then(setHits).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = useMemo(() => {
    if (!vault) return [];
    if (hits) return hits;
    const pinned = vault.notes.filter((n) => vault.profileNotes.includes(n.path));
    return [...pinned, ...vault.notes.filter((n) => !vault.profileNotes.includes(n.path))];
  }, [vault, hits]);

  const pinned = !!note && !!vault?.profileNotes.includes(note.path);
  const folder = note?.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : "";

  const resolveTarget = (target: string) => {
    const hit = note?.links.find((l) => l.target === target)?.path;
    if (hit) open(hit);
    else if (confirm(`“${target}” doesn't exist yet. Create it?`)) createNote(target);
  };

  async function createNote(name?: string) {
    const title = name ?? prompt("New note name (folders allowed, e.g. Projects/Idea)");
    if (!title?.trim()) return;
    const r = await api<{ path: string }>("/api/memory", { method: "PUT", json: { path: title.trim(), content: `# ${title.trim().split("/").pop()}\n\n` } });
    await loadVault();
    open(r.path);
    setEditing(true);
  }

  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="Your Obsidian vault is every agent's memory. Pinned profile notes go with every prompt; the most relevant notes are added per request."
      />
      {vaultErr && (
        <div className="card" style={{ marginBottom: 18, borderColor: "rgba(251,111,132,.4)" }}>
          <strong>Vault unavailable.</strong> <span className="muted">{vaultErr}</span>
        </div>
      )}
      <div className="row wrap" style={{ marginBottom: 18 }}>
        <span className="badge" title={vault?.root}>{vault?.root ?? "…"}</span>
        <span className="faint mono" style={{ fontSize: 12 }}>
          {vault?.notes.length ?? 0} notes · {vault?.profileNotes.length ?? 0} pinned
        </span>
        <span className="spacer" />
        <OmiImport onImported={loadVault} openNote={open} />
        <button className="btn" onClick={() => createNote()}>
          <FilePlus2 size={15} /> New note
        </button>
      </div>

      <div className="memory-layout">
        <div className="card tight">
          <div className="row" style={{ marginBottom: 10 }}>
            <Search size={15} className="faint" />
            <input className="input" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: "8px 12px" }} />
          </div>
          <div className="note-list">
            {!vault && !vaultErr && <Spinner />}
            {list
              .filter((n) => hits || !q.trim() || n.title.toLowerCase().includes(q.toLowerCase()))
              .map((n) => (
                <button key={n.path} className={`note-item ${n.path === selected ? "active" : ""}`} onClick={() => open(n.path)}>
                  <div className="row" style={{ gap: 6 }}>
                    {vault?.profileNotes.includes(n.path) && <Pin size={12} color="var(--accent)" />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</span>
                  </div>
                  <div className="f">
                    {n.folder || "/"} · {timeAgo(n.mtime)}
                  </div>
                  {"snippet" in n && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{(n as Hit).snippet.slice(0, 110)}…</div>}
                </button>
              ))}
          </div>
        </div>

        <div className="stack">
          {note ? (
            <div className="card">
              <div className="row between wrap" style={{ marginBottom: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow" style={{ fontSize: 10.5 }}>{note.path}</div>
                </div>
                <div className="row">
                  <button
                    className={`btn sm ${pinned ? "primary" : ""}`}
                    title="Pinned notes are sent to agents with every prompt"
                    onClick={async () => {
                      const r = await api<{ profileNotes: string[] }>("/api/memory", { method: "POST", json: { action: pinned ? "unpin" : "pin", path: note.path } });
                      setVault((v) => v && { ...v, profileNotes: r.profileNotes });
                    }}
                  >
                    {pinned ? <PinOff size={13} /> : <Pin size={13} />} {pinned ? "Pinned as profile" : "Pin as profile"}
                  </button>
                  {editing && (
                    <button
                      className="btn sm primary"
                      onClick={async () => {
                        await api("/api/memory", { method: "PUT", json: { path: note.path, content: draft } });
                        const n = await api<Note>(`/api/memory?path=${encodeURIComponent(note.path)}`);
                        setNote(n);
                        setEditing(false);
                        loadVault();
                        toast("Saved");
                      }}
                    >
                      <Save size={13} /> Save
                    </button>
                  )}
                  <button className="btn sm" onClick={() => setEditing((e) => !e)}>
                    {editing ? <><Eye size={13} /> View</> : <><Pencil size={13} /> Edit</>}
                  </button>
                  <button
                    className="btn sm ghost danger"
                    aria-label="Delete note"
                    onClick={async () => {
                      if (!confirm(`Delete ${note.path} from your vault? This can't be undone.`)) return;
                      await api(`/api/memory?path=${encodeURIComponent(note.path)}`, { method: "DELETE" });
                      open(null);
                      loadVault();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {editing ? (
                <textarea className="textarea mono" style={{ minHeight: 460, fontSize: 13.5 }} value={draft} onChange={(e) => setDraft(e.target.value)} />
              ) : (
                <Markdown onWikiLink={resolveTarget}>
                  {wikilinksToMarkdown(note.content, (name) => mediaUrl(`${vault?.root}/${folder ? folder + "/" : ""}${name}`))}
                </Markdown>
              )}
              <div className="grid cols-2" style={{ marginTop: 22 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}><Link2 size={11} /> Links · {note.links.length}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {note.links.map((l) => (
                      <button key={l.target} className={`btn sm ${l.path ? "" : "ghost"}`} onClick={() => resolveTarget(l.target)} title={l.path ? l.path : "not created yet"}>
                        {l.target}
                      </button>
                    ))}
                    {!note.links.length && <span className="faint" style={{ fontSize: 13 }}>none</span>}
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Backlinks · {note.backlinks.length}</div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {note.backlinks.map((b) => (
                      <button key={b.path} className="btn sm" onClick={() => open(b.path)}>{b.title}</button>
                    ))}
                    {!note.backlinks.length && <span className="faint" style={{ fontSize: 13 }}>none</span>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <Empty title="Pick a note">Tip: pin an “About Me” note with who you are, what you do and how you like to work — that&apos;s what makes every agent personal.</Empty>
          )}

          <div className="card">
            <SectionTitle icon={Brain} title="What agents see" meta="memory preview" />
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                setPreview(await api(`/api/memory/context?q=${encodeURIComponent(probe)}`));
              }}
            >
              <input className="input" placeholder="Type a prompt, e.g. write an SEO article about Hermes" value={probe} onChange={(e) => setProbe(e.target.value)} />
              <button className="btn" type="submit">Preview</button>
            </form>
            {preview && (
              <>
                <div className="faint mono" style={{ fontSize: 12, margin: "12px 0 6px" }}>
                  {preview.sources.length ? `${preview.sources.length} notes · ${preview.text.length.toLocaleString()} chars: ${preview.sources.join(", ")}` : "No notes matched and nothing is pinned."}
                </div>
                {preview.text && <pre className="console console-out" style={{ minHeight: 0, maxHeight: 300 }}>{preview.text}</pre>}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
