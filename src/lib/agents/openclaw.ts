import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatEvent, Settings } from "../types";
import { expandHome } from "../store";
import { runProcess, splitArgs, templateArgs } from "../proc";
import { type Agent, cliChat, flattenPrompt, offline } from "./base";
import { openaiChatStream, joinUrl, type OAMessage } from "./openai";
import { cleanCliOutput, countFiles } from "./hermes";

async function probeGateway(url: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = performance.now();
  try {
    // Any HTTP answer means the gateway process is listening.
    await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return { ok: false, ms: Math.round(performance.now() - started), error: err.cause?.code || err.message };
  }
}

export async function openclawInfo(s: Settings) {
  const home = expandHome(s.agents.openclaw.home);
  const agentsDir = path.join(home, "agents");
  let agents: string[] = [];
  try {
    agents = (await fs.readdir(agentsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* no agents dir */
  }
  const sessions = await countFiles(agentsDir, /\.jsonl$/, 3);
  return { agents, sessions };
}

export const openclawAgent: Agent = {
  id: "openclaw",
  name: "OpenClaw",
  supportsSessions: false,

  bin: (s) => s.agents.openclaw.bin,

  async status(s) {
    const o = s.agents.openclaw;
    if (!o.enabled) return offline("openclaw", "OpenClaw", false, "disabled");
    const [gw, ver, info] = await Promise.all([
      probeGateway(o.gatewayUrl),
      runProcess(o.bin, splitArgs(o.versionArgs || "--version"), { timeoutMs: 10_000 }),
      openclawInfo(s),
    ]);
    const version = ver.code === 0 ? ver.stdout.trim().split("\n")[0] : undefined;
    const meta = { agents: info.agents.length, sessions: info.sessions };
    return {
      id: "openclaw",
      name: "OpenClaw",
      enabled: true,
      online: gw.ok,
      version,
      latencyMs: gw.ok ? gw.ms : undefined,
      detail: `${info.agents.length} agents · ${info.sessions} sessions`,
      meta,
      error: gw.ok ? undefined : `gateway ${o.gatewayUrl} unreachable (${gw.error})${version ? "" : ` · ${ver.error || "cli missing"}`}`,
    };
  },

  async *chat(req, s): AsyncGenerator<ChatEvent> {
    const o = s.agents.openclaw;
    if (o.mode === "http") {
      const messages: OAMessage[] = [
        ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
        ...(req.history ?? []),
        { role: "user", content: req.prompt },
      ];
      yield* openaiChatStream({
        baseUrl: joinUrl(o.gatewayUrl, "v1"),
        apiKey: o.token,
        model: `openclaw:${o.agentId || "main"}`,
        messages,
        signal: req.signal,
      });
      return;
    }
    const prompt = flattenPrompt(req);
    const viaStdin = !o.chatArgs.includes("{prompt}");
    const args = templateArgs(o.chatArgs, { prompt, agent: o.agentId || "main" });
    yield* cliChat(o.bin, args, req, cleanCliOutput, viaStdin ? prompt : undefined);
  },
};
