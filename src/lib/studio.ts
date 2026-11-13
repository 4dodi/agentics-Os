import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentId, Settings, StudioItem } from "./types";
import { DATA_DIR, expandHome, newId, readJson, updateJson } from "./store";
import { complete } from "./agents";
import { joinUrl } from "./agents/openai";
import { vaultPath } from "./settings";
import { logActivity } from "./activity";

export const STUDIO_FILE = "studio.json";

export const MEDIA_EXT: Record<StudioItem["kind"], string[]> = {
  image: ["png", "jpg", "jpeg", "webp", "gif"],
  video: ["mp4", "webm", "mov", "m4v"],
  speech: ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"],
};
export const ALL_MEDIA_EXT = new Set(Object.values(MEDIA_EXT).flat().concat(["svg", "avif", "pdf"]));

export function outputDir(s: Settings) {
  return path.resolve(expandHome(s.studio.outputDir));
}

/** Folders the media endpoint may serve from. */
export function mediaRoots(s: Settings): string[] {
  return [DATA_DIR, outputDir(s), vaultPath(s), ...s.studio.mediaRoots.map((r) => path.resolve(expandHome(r)))];
}

const patch = (id: string, p: Partial<StudioItem>) =>
  updateJson<StudioItem[]>(STUDIO_FILE, [], (l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

export async function startStudio(kind: StudioItem["kind"], prompt: string, s: Settings): Promise<StudioItem> {
  const provider =
    kind === "image" ? s.studio.imageProvider : kind === "video" ? s.studio.videoProvider : s.studio.speechProvider;
  const item: StudioItem = { id: newId("st_"), kind, prompt, provider, status: "running", createdAt: Date.now() };
  await updateJson<StudioItem[]>(STUDIO_FILE, [], (l) => [item, ...l].slice(0, 500));

  void (async () => {
    const started = Date.now();
    try {
      const dir = outputDir(s);
      await fs.mkdir(dir, { recursive: true });
      let file: string;
      let output: string | undefined;
      if (provider === "api") {
        file = kind === "image" ? await apiImage(prompt, dir, s) : await apiSpeech(prompt, dir, s);
      } else {
        ({ file, output } = await agentMedia(provider as AgentId, kind, prompt, dir, s));
      }
      await patch(item.id, { status: "done", file, ms: Date.now() - started, output: output?.slice(0, 2000) });
      await logActivity({ kind: "studio", agent: provider === "api" ? "api" : (provider as AgentId), title: `${kind}: ${prompt.slice(0, 80)}`, ok: true, href: "/studio" });
    } catch (e) {
      await patch(item.id, { status: "error", error: (e as Error).message.slice(0, 1000), ms: Date.now() - started });
      await logActivity({ kind: "studio", title: `${kind} failed: ${prompt.slice(0, 70)}`, ok: false, href: "/studio" });
    }
  })();
  return item;
}

/** Pull candidate media paths/URLs out of an agent's reply. */
export function findMediaRefs(text: string, kind: StudioItem["kind"]): string[] {
  const ext = MEDIA_EXT[kind].join("|");
  const refs = new Set<string>();
  // ?path=%2F... links produced by this app (or copied from it)
  for (const m of text.matchAll(/[?&]path=([^\s&"'`)\]]+)/g)) {
    try {
      const p = decodeURIComponent(m[1]);
      if (new RegExp(`\\.(${ext})$`, "i").test(p)) refs.add(p);
    } catch {
      /* not encoded */
    }
  }
  for (const m of text.matchAll(new RegExp(`https?://[^\\s"'\`<>()\\]]+?\\.(?:${ext})(?:\\?[^\\s"'\`<>()\\]]*)?`, "gi"))) {
    if (!/\/api\/media\/file/.test(m[0])) refs.add(m[0]);
  }
  for (const m of text.matchAll(new RegExp(`(?:file://)?((?:~|/|[A-Za-z]:\\\\)[^\\n"'\`<>|*?]*?\\.(?:${ext}))(?=$|[\\s"'\`<>)\\],.;:!])`, "gim"))) {
    refs.add(m[1].trim());
  }
  return [...refs];
}

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

async function download(url: string, dir: string, fallbackExt: string, allowed: string[] = [fallbackExt]): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) downloads are allowed");
  const res = await fetch(u, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error("download too large");
  // The extension decides how the file is served later, so it must be one we expect for this kind.
  const urlExt = path.extname(u.pathname).slice(1).toLowerCase();
  const ext = allowed.includes(urlExt) ? urlExt : fallbackExt;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > MAX_DOWNLOAD_BYTES) throw new Error("download too large");
    chunks.push(chunk);
  }
  const file = path.join(dir, `${newId()}.${ext}`);
  await fs.writeFile(file, Buffer.concat(chunks));
  return file;
}

async function newestSince(dir: string, since: number, exts: string[]): Promise<string | null> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  let best: { f: string; t: number } | null = null;
  for (const name of entries) {
    if (!exts.includes(name.split(".").pop()?.toLowerCase() || "")) continue;
    const f = path.join(dir, name);
    const st = await fs.stat(f).catch(() => null);
    if (st && st.mtimeMs >= since - 1000 && (!best || st.mtimeMs > best.t)) best = { f, t: st.mtimeMs };
  }
  return best?.f ?? null;
}

async function agentMedia(agent: AgentId, kind: StudioItem["kind"], prompt: string, dir: string, s: Settings) {
  const since = Date.now();
  const what = kind === "speech" ? "spoken audio (text-to-speech) of the text below" : `a ${kind}`;
  const instruction = `Use your ${kind === "speech" ? "text-to-speech" : `${kind} generation`} tool to create ${what}.
Save the final file into this folder: ${dir}
When it is finished, reply with the absolute path of the saved file on its own line (no other commentary needed).

${kind === "speech" ? "Text to speak" : "Prompt"}:
${prompt}`;
  const output = await complete(agent, { prompt: instruction, timeoutMs: 20 * 60_000 }, s);

  for (const ref of findMediaRefs(output, kind)) {
    if (/^https?:/i.test(ref)) {
      try {
        return { file: await download(ref, dir, MEDIA_EXT[kind][0], MEDIA_EXT[kind]), output };
      } catch {
        continue;
      }
    }
    const p = await fs.realpath(path.resolve(expandHome(ref))).catch(() => null);
    if (!p || !MEDIA_EXT[kind].includes(path.extname(p).slice(1).toLowerCase())) continue;
    if (await fs.stat(p).then((st) => st.isFile()).catch(() => false)) return { file: p, output };
  }
  const recent = await newestSince(dir, since, MEDIA_EXT[kind]);
  if (recent) return { file: recent, output };
  throw new Error(`${agent} didn't return a ${kind} file. Reply: ${output.slice(0, 600) || "(empty)"}`);
}

async function apiImage(prompt: string, dir: string, s: Settings): Promise<string> {
  const st = s.studio;
  if (!st.apiKey) throw new Error("Studio API key missing (Settings → Studio)");
  const res = await fetch(joinUrl(st.apiBaseUrl, "images/generations"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${st.apiKey}` },
    body: JSON.stringify({ model: st.imageModel, prompt, n: 1 }),
    signal: AbortSignal.timeout(300_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`image API ${res.status}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  const d = j.data?.[0];
  if (d?.b64_json) {
    const file = path.join(dir, `${newId("img_")}.png`);
    await fs.writeFile(file, Buffer.from(d.b64_json, "base64"));
    return file;
  }
  if (d?.url) return download(d.url, dir, "png", MEDIA_EXT.image);
  throw new Error("image API returned no image");
}

async function apiSpeech(text: string, dir: string, s: Settings): Promise<string> {
  const st = s.studio;
  if (!st.apiKey) throw new Error("Studio API key missing (Settings → Studio)");
  const res = await fetch(joinUrl(st.apiBaseUrl, "audio/speech"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${st.apiKey}` },
    body: JSON.stringify({ model: st.ttsModel, voice: st.ttsVoice, input: text, response_format: "mp3" }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`speech API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const file = path.join(dir, `${newId("tts_")}.mp3`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Copy a finished item into the vault with a note that embeds it. */
export async function saveToVault(id: string, s: Settings): Promise<string> {
  const item = (await readJson<StudioItem[]>(STUDIO_FILE, [])).find((x) => x.id === id);
  if (!item?.file) throw new Error("item has no file");
  const root = vaultPath(s);
  const dir = path.join(root, "Studio");
  await fs.mkdir(dir, { recursive: true });
  const src = await fs.realpath(item.file);
  if (!ALL_MEDIA_EXT.has(path.extname(src).slice(1).toLowerCase())) throw new Error("item is not a media file");
  const name = path.basename(item.file);
  await fs.copyFile(src, path.join(dir, name));
  const note = `# ${item.kind}: ${item.prompt.slice(0, 60)}\n\n![[${name}]]\n\n- Created: ${new Date(item.createdAt).toISOString()}\n- Provider: ${item.provider}\n\n## Prompt\n${item.prompt}\n`;
  const noteName = `${name.replace(/\.[^.]+$/, "")}.md`;
  await fs.writeFile(path.join(dir, noteName), note);
  return `Studio/${noteName}`;
}
