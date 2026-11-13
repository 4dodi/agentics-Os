import type { Settings } from "./types";
import { readJson, updateJson } from "./store";
import { ensureVault, readNote, writeNote } from "./vault";
import { localDate } from "./journal";
import { logActivity } from "./activity";

/**
 * OMI (omi.me) daily memory import: conversations captured by the OMI wearable become
 * one Markdown note per day in the vault, so every agent can use them as memory.
 * API: GET {baseUrl}/v1/dev/user/conversations with a developer key (omi_dev_…).
 */

export const OMI_STATE = "omi.json";
const PAGE = 50;
const MAX_PAGES = 40;
const FIRST_IMPORT_DAYS = 7;
const TRANSCRIPT_CHARS = 6000;

export interface OmiState {
  /** ISO time of the newest conversation start already imported. */
  lastStartedAt?: string;
  lastImportAt?: number;
  lastResult?: OmiImportResult;
}

export interface OmiImportResult {
  ok: boolean;
  conversations: number;
  added: number;
  skipped: number;
  notes: string[];
  error?: string;
}

interface OmiActionItem {
  description?: string;
  completed?: boolean;
}

export interface OmiConversation {
  id: string;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  source?: string;
  discarded?: boolean;
  structured?: {
    title?: string;
    overview?: string;
    emoji?: string;
    category?: string;
    action_items?: OmiActionItem[];
  };
  folder_name?: string | null;
  geolocation?: { address?: string | null } | null;
  transcript_segments?: { text?: string; speaker_name?: string | null; speaker_id?: number | null; is_user?: boolean }[];
}

const startOf = (c: OmiConversation) => c.started_at || c.created_at || "";
const clean = (s: unknown) => String(s ?? "").replace(/\r/g, "").trim();
/** Keep model/user text from closing our marker comments or starting a new top-level section. */
const safeLine = (s: unknown) => clean(s).replace(/<!--|-->/g, "").replace(/^#{1,2}\s/gm, "### ");

function hhmm(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function omiNotePath(folder: string, date: string) {
  return `${folder}/OMI ${date}.md`;
}

export function marker(id: string) {
  return `<!-- omi:${String(id).replace(/[^\w.-]/g, "")} -->`;
}

/** One conversation as a Markdown block. Pure, so it can be tested. */
export function formatConversation(c: OmiConversation, includeTranscript: boolean): string {
  const st = c.structured ?? {};
  const title = safeLine(st.title) || "Untitled conversation";
  const time = [hhmm(c.started_at || c.created_at), hhmm(c.finished_at)].filter(Boolean).join("–");
  const meta = [time, clean(st.category), clean(c.folder_name), clean(c.geolocation?.address)].filter(Boolean).join(" · ");
  const lines = [`## ${st.emoji ? `${clean(st.emoji)} ` : ""}${title}`, marker(c.id)];
  if (meta) lines.push(`*${safeLine(meta)}*`);
  if (st.overview) lines.push("", safeLine(st.overview));
  const items = (st.action_items ?? []).filter((a) => clean(a.description));
  if (items.length) {
    lines.push("", "**Action items**");
    for (const a of items) lines.push(`- [${a.completed ? "x" : " "}] ${safeLine(a.description)}`);
  }
  const segs = c.transcript_segments ?? [];
  if (includeTranscript && segs.length) {
    let text = segs
      .map((s) => {
        const who = s.is_user ? "Me" : clean(s.speaker_name) || (s.speaker_id !== undefined && s.speaker_id !== null ? `Speaker ${s.speaker_id}` : "Speaker");
        return `> **${safeLine(who)}:** ${safeLine(s.text).replace(/\n/g, " ")}`;
      })
      .join("\n");
    if (text.length > TRANSCRIPT_CHARS) text = text.slice(0, TRANSCRIPT_CHARS) + "\n> …";
    lines.push("", "**Transcript**", text);
  }
  return lines.join("\n");
}

function dayHeader(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `# OMI · ${label}\n\nConversations captured by OMI. Journal: [[${date}]]\n`;
}

/**
 * Merge conversations into the per-day notes. Already-imported conversations (found by their
 * marker) are skipped, so importing twice never duplicates anything.
 */
export async function writeConversations(
  convs: OmiConversation[],
  s: Settings,
): Promise<Pick<OmiImportResult, "added" | "skipped" | "notes">> {
  const root = await ensureVault(s);
  const byDay = new Map<string, OmiConversation[]>();
  for (const c of convs) {
    if (!c?.id || c.discarded) continue;
    const t = Date.parse(startOf(c));
    const day = Number.isNaN(t) ? localDate() : localDate(t);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }
  let added = 0;
  let skipped = 0;
  const notes: string[] = [];
  for (const [day, list] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    const rel = omiNotePath(s.omi.folder, day);
    let content = (await readNote(root, rel).catch(() => null)) ?? dayHeader(day);
    let changed = false;
    for (const c of list.sort((a, b) => startOf(a).localeCompare(startOf(b)))) {
      if (content.includes(marker(c.id))) {
        skipped++;
        continue;
      }
      content = content.trimEnd() + "\n\n" + formatConversation(c, s.omi.includeTranscript) + "\n";
      added++;
      changed = true;
    }
    if (changed) {
      await writeNote(root, rel, content);
      notes.push(rel);
    }
  }
  return { added, skipped, notes };
}

async function fetchPage(s: Settings, startDate: string, offset: number): Promise<OmiConversation[]> {
  const u = new URL("/v1/dev/user/conversations", s.omi.baseUrl.replace(/\/+$/, "") + "/");
  u.searchParams.set("limit", String(PAGE));
  u.searchParams.set("offset", String(offset));
  u.searchParams.set("start_date", startDate);
  if (s.omi.includeTranscript) u.searchParams.set("include_transcript", "true");
  const res = await fetch(u, { headers: { authorization: `Bearer ${s.omi.apiKey}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`OMI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("OMI returned an unexpected response");
  return data as OmiConversation[];
}

const g = globalThis as unknown as { __omiImporting?: boolean };

/** Pull new conversations since the last import (the last 7 days on the first run) into the vault. */
export async function importFromOmi(s: Settings, opts: { sinceDays?: number } = {}): Promise<OmiImportResult> {
  if (!s.omi.apiKey) throw new Error("Add your OMI developer API key in Settings → OMI first");
  if (g.__omiImporting) throw new Error("An OMI import is already running");
  g.__omiImporting = true;
  try {
    const state = await readJson<OmiState>(OMI_STATE, {});
    const since = opts.sinceDays
      ? new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString()
      : state.lastStartedAt || new Date(Date.now() - FIRST_IMPORT_DAYS * 86_400_000).toISOString();
    let result: OmiImportResult;
    try {
      const all: OmiConversation[] = [];
      for (let p = 0; p < MAX_PAGES; p++) {
        const page = await fetchPage(s, since, p * PAGE);
        all.push(...page);
        if (page.length < PAGE) break;
      }
      const w = await writeConversations(all, s);
      const newest = all.map(startOf).filter(Boolean).sort().pop();
      result = { ok: true, conversations: all.length, ...w };
      await updateJson<OmiState>(OMI_STATE, {}, (st) => ({
        ...st,
        lastStartedAt: newest && (!st.lastStartedAt || newest > st.lastStartedAt) ? newest : st.lastStartedAt,
        lastImportAt: Date.now(),
        lastResult: result,
      }));
    } catch (e) {
      result = { ok: false, conversations: 0, added: 0, skipped: 0, notes: [], error: (e as Error).message };
      await updateJson<OmiState>(OMI_STATE, {}, (st) => ({ ...st, lastImportAt: Date.now(), lastResult: result }));
    }
    if (!result.ok || result.added) {
      await logActivity({
        kind: "memory",
        title: result.ok ? `OMI: ${result.added} conversation${result.added === 1 ? "" : "s"} imported` : "OMI import failed",
        detail: result.error ?? result.notes.join(", "),
        ok: result.ok,
        href: result.notes[0] ? `/memory?note=${encodeURIComponent(result.notes[result.notes.length - 1])}` : "/memory",
      });
    }
    if (!result.ok) throw new Error(result.error);
    return result;
  } finally {
    g.__omiImporting = false;
  }
}

/** Import from a pasted/uploaded OMI export: an array of conversations, or { conversations: [...] }. */
export async function importOmiJson(raw: string, s: Settings): Promise<OmiImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That isn't valid JSON");
  }
  const list = Array.isArray(data) ? data : (data as { conversations?: unknown })?.conversations;
  if (!Array.isArray(list)) throw new Error("Expected an array of OMI conversations");
  const convs = list.filter((c): c is OmiConversation => !!c && typeof c === "object" && "id" in c);
  const w = await writeConversations(convs, s);
  const result: OmiImportResult = { ok: true, conversations: convs.length, ...w };
  if (result.added) await logActivity({ kind: "memory", title: `OMI: ${result.added} conversations imported from file`, ok: true, href: "/memory" });
  return result;
}
