import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatEvent, Settings } from "../types";
import { expandHome } from "../store";
import { runProcess, splitArgs, templateArgs } from "../proc";
import { type Agent, cliChat, flattenPrompt, offline } from "./base";
import { openaiChatStream, probeModels, type OAMessage } from "./openai";

/** Strip decorative TUI chrome (box borders, spinners) that some agent CLIs print around answers. */
export function cleanCliOutput(s: string): string {
  return s
    .split("\n")
    .filter((l) => !/^[\s╭╮╰╯─│┌┐└┘═║╔╗╚╝━┃⠀-⣿]*$/.test(l) || l.trim() === "")
    .map((l) => l.replace(/^\s*[│┃║]\s?/, "").replace(/\s?[│┃║]\s*$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

async function readHermesModel(home: string): Promise<{ model?: string; provider?: string }> {
  try {
    const yaml = await fs.readFile(path.join(expandHome(home), "config.yaml"), "utf8");
    const inline = yaml.match(/^model:\s*["']?([^"'\n#]+)["']?\s*$/m);
    if (inline) return { model: inline[1].trim() };
    const block = yaml.match(/^model:\s*\n((?:[ \t]+.*\n?)+)/m)?.[1] ?? "";
    const pick = (k: string) => block.match(new RegExp(`^\\s+${k}:\\s*["']?([^"'\\n#]+)`, "m"))?.[1]?.trim();
    return { model: pick("default") || pick("model") || pick("name"), provider: pick("provider") };
  } catch {
    return {};
  }
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  category: string;
}

export async function listSkills(root: string, maxDepth = 4): Promise<SkillInfo[]> {
  const base = expandHome(root);
  const out: SkillInfo[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || out.length > 500) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
      const md = await fs.readFile(path.join(dir, "SKILL.md"), "utf8").catch(() => "");
      const fm = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const field = (k: string) => fm.match(new RegExp(`^${k}:\\s*["']?(.+?)["']?\\s*$`, "m"))?.[1] ?? "";
      const rel = path.relative(base, dir);
      out.push({
        name: field("name") || path.basename(dir),
        description: field("description") || md.replace(/^---[\s\S]*?---/, "").trim().split("\n")[0]?.slice(0, 160) || "",
        path: dir,
        category: rel.includes(path.sep) ? rel.split(path.sep)[0] : "",
      });
      return;
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) await walk(path.join(dir, e.name), depth + 1);
  }
  await walk(base, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function countFiles(dir: string, pattern: RegExp, maxDepth = 3): Promise<number> {
  let n = 0;
  async function walk(d: string, depth: number) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && pattern.test(e.name)) n++;
      else if (e.isDirectory() && depth < maxDepth) await walk(path.join(d, e.name), depth + 1);
    }
  }
  await walk(expandHome(dir), 0);
  return n;
}

export async function hermesInfo(s: Settings) {
  const h = s.agents.hermes;
  const [cfg, skills, sessions] = await Promise.all([
    readHermesModel(h.home),
    listSkills(path.join(h.home, "skills")),
    countFiles(path.join(h.home, "sessions"), /\.(json|jsonl)$/),
  ]);
  return { ...cfg, skills, sessions };
}

export const hermesAgent: Agent = {
  id: "hermes",
  name: "Hermes",
  supportsSessions: false,

  bin: (s) => (s.agents.hermes.mode === "cli" ? s.agents.hermes.bin : s.agents.hermes.bin || null),

  async status(s) {
    const h = s.agents.hermes;
    if (!h.enabled) return offline("hermes", "Hermes", false, "disabled");
    const info = await hermesInfo(s);
    const modelLabel = [info.model, info.provider].filter(Boolean).join(" · ");
    const meta = { skills: info.skills.length, sessions: info.sessions };

    if (h.mode === "http") {
      const p = await probeModels(h.baseUrl, h.apiKey);
      if (!p.ok) return { ...offline("hermes", "Hermes", true, p.error), meta };
      return {
        id: "hermes", name: "Hermes", enabled: true, online: true, latencyMs: p.ms,
        model: modelLabel || p.models?.[0] || h.model, detail: modelLabel || `API · ${p.ms}ms`, meta,
      };
    }
    const r = await runProcess(h.bin, splitArgs(h.versionArgs || "--version"), { timeoutMs: 10_000 });
    if (r.error || r.code !== 0) return { ...offline("hermes", "Hermes", true, r.error || r.stderr.trim().slice(0, 200)), meta };
    const version = (r.stdout.trim() || r.stderr.trim()).split("\n")[0];
    return {
      id: "hermes", name: "Hermes", enabled: true, online: true, version, latencyMs: r.ms,
      model: modelLabel || undefined, detail: modelLabel || version, meta,
    };
  },

  async *chat(req, s): AsyncGenerator<ChatEvent> {
    const h = s.agents.hermes;
    if (h.mode === "http") {
      const messages: OAMessage[] = [
        ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
        ...(req.history ?? []),
        { role: "user", content: req.prompt },
      ];
      yield* openaiChatStream({ baseUrl: h.baseUrl, apiKey: h.apiKey, model: h.model, messages, signal: req.signal });
      return;
    }
    const prompt = flattenPrompt(req);
    const viaStdin = !h.chatArgs.includes("{prompt}");
    const args = templateArgs(h.chatArgs, { prompt });
    yield* cliChat(h.bin, args, req, cleanCliOutput, viaStdin ? prompt : undefined);
  },
};
