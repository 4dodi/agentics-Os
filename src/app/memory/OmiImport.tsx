"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, Upload } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { Spinner, useToast } from "@/components/ui";

interface OmiStatus {
  configured: boolean;
  autoImport: boolean;
  folder: string;
  lastImportAt?: number;
  lastResult?: { ok: boolean; added: number; conversations: number; error?: string; notes: string[] };
}

/** "Import from OMI" button + file import for OMI exports, shown in the Memory header. */
export function OmiImport({ onImported, openNote }: { onImported: () => void; openNote: (path: string) => void }) {
  const toast = useToast();
  const [st, setSt] = useState<OmiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = () => api<OmiStatus>("/api/omi").then(setSt).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function run(payload: object) {
    setBusy(true);
    try {
      const r = await api<{ added: number; skipped: number; conversations: number; notes: string[] }>("/api/omi", { method: "POST", json: payload });
      toast(r.added ? `Imported ${r.added} OMI conversation${r.added === 1 ? "" : "s"} into ${r.notes.length} note${r.notes.length === 1 ? "" : "s"}` : `Nothing new (${r.conversations} checked)`);
      onImported();
      if (r.notes.length) openNote(r.notes[r.notes.length - 1]);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
      load();
    }
  }

  const last = st?.lastResult;
  return (
    <>
      {st?.lastImportAt && (
        <span className={`faint mono ${last && !last.ok ? "err" : ""}`} style={{ fontSize: 11.5 }} title={last?.error}>
          OMI {last?.ok === false ? "failed" : "synced"} {timeAgo(st.lastImportAt)}
          {st.autoImport && " · auto"}
        </span>
      )}
      {st?.configured ? (
        <button className="btn" onClick={() => run({ action: "import" })} disabled={busy}>
          {busy ? <Spinner size={15} /> : <Mic size={15} />} Import from OMI
        </button>
      ) : (
        <Link className="btn" href="/settings#omi" title="Add your OMI developer key to import conversations">
          <Mic size={15} /> Connect OMI
        </Link>
      )}
      <button className="btn icon ghost" aria-label="Import an OMI export file (JSON)" title="Import an OMI export file (JSON)" onClick={() => file.current?.click()} disabled={busy}>
        <Upload size={15} />
      </button>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) run({ action: "json", data: await f.text() });
        }}
      />
    </>
  );
}
