import type { AgentId, AgentStatus, ChatEvent, Settings } from "../types";
import type { OAMessage } from "./openai";
import { stripAnsi, streamProcess } from "../proc";

export interface ChatRequest {
  prompt: string;
  /** Extra system context (memory, skills). */
  system?: string;
  /** Previous turns, used by agents that don't keep their own sessions. */
  history?: OAMessage[];
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Agent {
  id: AgentId;
  name: string;
  /** True when the agent keeps conversation state itself (we pass a session id instead of history). */
  supportsSessions: boolean;
  status(s: Settings): Promise<AgentStatus>;
  chat(req: ChatRequest, s: Settings): AsyncGenerator<ChatEvent>;
  /** Binary used by the Control Room console, or null if the agent has no CLI. */
  bin(s: Settings): string | null;
}

/** Flatten system + history + prompt into one message for one-shot CLIs. */
export function flattenPrompt(req: ChatRequest): string {
  const parts: string[] = [];
  if (req.system) parts.push(req.system.trim());
  if (req.history?.length) {
    const convo = req.history
      .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.content}`)
      .join("\n\n");
    parts.push(`<previous_conversation>\n${convo}\n</previous_conversation>`);
  }
  parts.push(req.prompt);
  return parts.join("\n\n");
}

/** Run a one-shot CLI and stream its stdout as deltas. */
export async function* cliChat(
  bin: string,
  args: string[],
  req: ChatRequest,
  clean: (s: string) => string = (s) => s,
  stdin?: string,
): AsyncGenerator<ChatEvent> {
  const started = performance.now();
  let text = "";
  let stderr = "";
  for await (const c of streamProcess(bin, args, { signal: req.signal, timeoutMs: req.timeoutMs ?? 15 * 60_000, stdin })) {
    if ("exit" in c) {
      const finalText = clean(stripAnsi(text)).trim();
      if (c.error || (c.exit !== 0 && !finalText)) {
        yield { type: "error", message: c.error || stripAnsi(stderr).trim().slice(-800) || `exited with code ${c.exit}` };
        return;
      }
      yield { type: "done", text: finalText, ms: Math.round(performance.now() - started) };
      return;
    }
    if (c.stream === "stderr") {
      stderr += c.text;
      continue;
    }
    text += c.text;
    yield { type: "delta", text: stripAnsi(c.text) };
  }
}

export function offline(id: AgentId, name: string, enabled: boolean, error?: string): AgentStatus {
  return { id, name, enabled, online: false, error };
}
