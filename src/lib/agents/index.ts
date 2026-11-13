import type { AgentId, AgentStatus, ChatEvent, Settings } from "../types";
import { type Agent, type ChatRequest, offline } from "./base";
import { claudeAgent } from "./claude";
import { hermesAgent } from "./hermes";
import { openclawAgent } from "./openclaw";
import { openaiChatStream, probeModels, type OAMessage } from "./openai";

/** Any OpenAI-compatible API (OpenRouter, DeepSeek, xAI…) — the no-install fallback engine. */
const apiAgent: Agent = {
  id: "api",
  name: "API",
  supportsSessions: false,
  bin: () => null,
  async status(s) {
    const a = s.agents.api;
    if (!a.enabled || !a.apiKey) return offline("api", "API", a.enabled, a.apiKey ? "disabled" : "no API key");
    const p = await probeModels(a.baseUrl, a.apiKey);
    if (!p.ok) return offline("api", "API", true, p.error);
    return { id: "api", name: "API", enabled: true, online: true, latencyMs: p.ms, model: a.model, detail: `${a.model} · ${p.ms}ms` };
  },
  async *chat(req, s) {
    const a = s.agents.api;
    const messages: OAMessage[] = [
      ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
      ...(req.history ?? []),
      { role: "user", content: req.prompt },
    ];
    yield* openaiChatStream({ baseUrl: a.baseUrl, apiKey: a.apiKey, model: a.model, messages, signal: req.signal });
  },
};

export const AGENTS: Record<AgentId, Agent> = {
  claude: claudeAgent,
  hermes: hermesAgent,
  openclaw: openclawAgent,
  api: apiAgent,
};

/** Whether an agent is switched on in Settings (background features skip disabled agents). */
export function agentEnabled(id: AgentId, s: Settings): boolean {
  return Boolean(s.agents[id]?.enabled);
}

export function getAgent(id: string): Agent | null {
  return (AGENTS as Record<string, Agent>)[id] ?? null;
}

// Status probes spawn processes, so share results between concurrent pollers for a moment.
type Cached = { at: number; value: Promise<AgentStatus> };
const g = globalThis as unknown as { __agentStatusCache?: Map<AgentId, Cached> };
const cache = (g.__agentStatusCache ??= new Map());

export function agentStatus(id: AgentId, s: Settings, maxAgeMs = 2500): Promise<AgentStatus> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.value;
  const value = AGENTS[id].status(s).catch((e) => offline(id, AGENTS[id].name, true, (e as Error).message));
  cache.set(id, { at: Date.now(), value });
  return value;
}

/** Run a full turn and return the final text (throws on agent error). */
export async function complete(id: AgentId, req: ChatRequest, s: Settings, onDelta?: (text: string) => void): Promise<string> {
  let out = "";
  for await (const ev of AGENTS[id].chat(req, s) as AsyncGenerator<ChatEvent>) {
    if (ev.type === "delta") {
      out += ev.text;
      onDelta?.(ev.text);
    } else if (ev.type === "error") throw new Error(ev.message);
    else if (ev.type === "done") return ev.text || out;
  }
  return out;
}

export type { Agent, ChatRequest };
