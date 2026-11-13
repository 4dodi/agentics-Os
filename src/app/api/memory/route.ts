import { getSettings, saveSettings } from "@/lib/settings";
import {
  backlinks, deleteNote, ensureVault, extractLinks, listNotes, readNote, resolveLink, searchNotes, writeNote,
} from "@/lib/vault";
import { body, fail, json } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

async function root() {
  return ensureVault(await getSettings());
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q");
  const p = u.searchParams.get("path");
  let r: string;
  try {
    r = await root();
  } catch (e) {
    return fail((e as Error).message, 404);
  }
  if (q) return json(await searchNotes(r, q, 30));
  if (p) {
    const notes = await listNotes(r);
    const content = await readNote(r, p).catch(() => null);
    if (content === null) return fail("note not found", 404);
    const links = extractLinks(content).map((target) => ({ target, path: resolveLink(notes, target)?.path ?? null }));
    return json({ path: p, content, links, backlinks: await backlinks(r, notes, p) });
  }
  const s = await getSettings();
  return json({ root: r, notes: await listNotes(r), profileNotes: s.vault.profileNotes });
}

export async function PUT(req: Request) {
  const { path, content } = await body<{ path?: string; content?: string }>(req);
  if (!path) return fail("path is required");
  const r = await root();
  const isNew = (await readNote(r, path).catch(() => null)) === null;
  try {
    await writeNote(r, path, String(content ?? ""));
  } catch (e) {
    return fail((e as Error).message);
  }
  if (isNew) await logActivity({ kind: "memory", title: `New note: ${path}`, href: `/memory?note=${encodeURIComponent(path)}` });
  return json({ ok: true, path: path.endsWith(".md") ? path : `${path}.md` });
}

export async function DELETE(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return fail("path is required");
  try {
    await deleteNote(await root(), p);
  } catch (e) {
    return fail((e as Error).message);
  }
  return json({ ok: true });
}

/** Pin / unpin a note as always-injected profile memory. */
export async function POST(req: Request) {
  const { action, path } = await body<{ action?: string; path?: string }>(req);
  if (!path) return fail("path is required");
  if (!path.toLowerCase().endsWith(".md")) return fail("only Markdown notes can be pinned");
  const s = await getSettings();
  const set = new Set(s.vault.profileNotes);
  if (action === "pin") set.add(path);
  else if (action === "unpin") set.delete(path);
  else return fail("action must be pin or unpin");
  const next = await saveSettings({ vault: { profileNotes: [...set] } });
  return json({ profileNotes: next.vault.profileNotes });
}
