import { promises as fs } from "node:fs";
import path from "node:path";
import type { NoteMeta, Settings } from "./types";
import { getSettings, vaultPath } from "./settings";
import { DATA_DIR, exists } from "./store";

const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".DS_Store"]);
const MAX_NOTES = 8000;

/** Resolve a vault-relative path and refuse anything that escapes the vault. */
export function resolveInVault(root: string, rel: string): string {
  const full = path.resolve(root, rel.replace(/^\/+/, ""));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Path escapes the vault");
  return full;
}

export async function ensureVault(s?: Settings): Promise<string> {
  const settings = s ?? (await getSettings());
  const root = vaultPath(settings);
  const builtIn = root.startsWith(DATA_DIR + path.sep);
  if (!builtIn) {
    if (!(await exists(root))) throw new Error(`Vault folder not found: ${root} — check Settings → Memory`);
    return root;
  }
  // Seed the built-in starter vault (never a user's own vault) so memory has something to work with.
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root);
  if (!entries.some((e) => !e.startsWith("."))) {
    await fs.writeFile(
      path.join(root, "About Me.md"),
      `# About Me\n\nThis note is pinned as **profile memory**: every agent reads it before answering.\nReplace this with who you are, what you do and how you like to work.\n\n## Who I am\n- Name:\n- Business:\n- Audience:\n\n## What I'm working on\n- \n\n## How I like things\n- Tone of voice:\n- Tools I use: [[Agentic OS]]\n`,
    );
    await fs.writeFile(
      path.join(root, "Agentic OS.md"),
      `# Agentic OS\n\nMy local dashboard for Claude, Hermes and OpenClaw. Links: [[About Me]]\n\n- SEO pipeline deploys to Netlify\n- Studio generates images, video and speech\n- Journal notes land in \`Journal/\`\n`,
    );
  }
  return root;
}

export async function listNotes(root: string): Promise<NoteMeta[]> {
  const out: NoteMeta[] = [];
  async function walk(dir: string) {
    if (out.length >= MAX_NOTES) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith(".md")) {
        const st = await fs.stat(full).catch(() => null);
        if (!st) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        out.push({
          path: rel,
          title: e.name.replace(/\.md$/, ""),
          folder: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
          mtime: st.mtimeMs,
          size: st.size,
        });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function readNote(root: string, rel: string): Promise<string> {
  return fs.readFile(resolveInVault(root, rel), "utf8");
}

export async function writeNote(root: string, rel: string, content: string): Promise<void> {
  const full = resolveInVault(root, rel.endsWith(".md") ? rel : `${rel}.md`);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

export async function deleteNote(root: string, rel: string): Promise<void> {
  await fs.rm(resolveInVault(root, rel));
}

/** [[Target]], [[Target|alias]], [[Target#heading]] → "Target" */
export function extractLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim());
  return [...out];
}

/** Map a wikilink target to a note path (Obsidian resolves by basename first). */
export function resolveLink(notes: NoteMeta[], target: string): NoteMeta | undefined {
  const t = target.replace(/\.md$/, "").toLowerCase();
  return (
    notes.find((n) => n.path.replace(/\.md$/, "").toLowerCase() === t) ||
    notes.find((n) => n.title.toLowerCase() === t.split("/").pop())
  );
}

export async function backlinks(root: string, notes: NoteMeta[], rel: string): Promise<NoteMeta[]> {
  const me = notes.find((n) => n.path === rel);
  if (!me) return [];
  const hits: NoteMeta[] = [];
  await Promise.all(
    notes.map(async (n) => {
      if (n.path === rel || n.size > 400_000) return;
      const md = await readNote(root, n.path).catch(() => "");
      if (extractLinks(md).some((l) => resolveLink(notes, l)?.path === rel)) hits.push(n);
    }),
  );
  return hits.sort((a, b) => b.mtime - a.mtime);
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w));
}
const STOP = new Set(
  "the and for with that this from your you are was what how can will about have has into they them then than there their our out not but all any its use using make write please just like want need".split(
    " ",
  ),
);

export interface SearchHit extends NoteMeta {
  score: number;
  snippet: string;
}

export async function searchNotes(root: string, query: string, limit = 20): Promise<SearchHit[]> {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const notes = await listNotes(root);
  const hits: SearchHit[] = [];
  await Promise.all(
    notes.map(async (n) => {
      if (n.size > 400_000) return;
      const md = await readNote(root, n.path).catch(() => "");
      const lower = md.toLowerCase();
      const title = n.title.toLowerCase();
      let score = 0;
      let firstIdx = -1;
      for (const t of terms) {
        if (title.includes(t)) score += 6;
        let idx = lower.indexOf(t);
        let count = 0;
        if (idx >= 0 && (firstIdx < 0 || idx < firstIdx)) firstIdx = idx;
        while (idx >= 0 && count < 20) {
          count++;
          idx = lower.indexOf(t, idx + t.length);
        }
        score += Math.log2(1 + count) * 2;
      }
      if (score <= 0) return;
      // Prefer recently edited notes a little.
      const ageDays = (Date.now() - n.mtime) / 86_400_000;
      score += Math.max(0, 1 - ageDays / 90);
      const start = Math.max(0, firstIdx - 80);
      const snippet = md.slice(start, start + 240).replace(/\s+/g, " ").trim();
      hits.push({ ...n, score, snippet });
    }),
  );
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The "agent knows who you are" layer: pinned profile notes + the notes most relevant to
 * the request, packed into a system-prompt block under a character budget.
 */
export async function buildMemoryContext(query: string, s?: Settings): Promise<{ text: string; sources: string[] }> {
  const settings = s ?? (await getSettings());
  const root = await ensureVault(settings).catch(() => null);
  if (!root) return { text: "", sources: [] };
  const budget = settings.vault.maxContextChars || 6000;
  const sources: string[] = [];
  const sections: string[] = [];
  let used = 0;

  const add = (label: string, rel: string, body: string, share: number) => {
    const room = Math.min(budget - used, share);
    if (room < 200) return;
    const clipped = body.length > room ? body.slice(0, room) + "\n…" : body;
    sections.push(`### ${label}: ${rel}\n${clipped.trim()}`);
    sources.push(rel);
    used += clipped.length;
  };

  for (const rel of settings.vault.profileNotes) {
    const body = await readNote(root, rel).catch(() => null);
    if (body) add("Profile", rel, body, Math.floor(budget * 0.5));
  }
  const hits = (await searchNotes(root, query, 6)).filter((h) => !sources.includes(h.path));
  for (const h of hits.slice(0, 4)) {
    const body = await readNote(root, h.path).catch(() => "");
    add("Relevant note", h.path, body, Math.floor(budget * 0.25));
  }
  if (!sections.length) return { text: "", sources };
  const text = [
    "<memory source=\"obsidian-vault\">",
    "The user's own notes. Use them to personalise your answer; don't quote them back unless asked.",
    ...sections,
    "</memory>",
  ].join("\n\n");
  return { text, sources };
}
