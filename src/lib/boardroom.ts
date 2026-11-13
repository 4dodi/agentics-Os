import type { AgentId, BoardroomReply, BoardroomSession, ChatEvent, Settings } from "./types";
import { AGENT_IDS } from "./types";
import { AGENTS, agentEnabled } from "./agents";
import { buildMemoryContext } from "./vault";
import { newId, updateJson } from "./store";
import { logActivity } from "./activity";

export const BOARDROOM_FILE = "boardroom.json";
const MAX_SESSIONS = 100;
const REPLY_TIMEOUT_MS = 15 * 60_000;

export type BoardroomEvent =
  | { type: "start"; session: BoardroomSession }
  | { type: "memory"; sources: string[] }
  | { type: "delta"; agent: AgentId; text: string; synthesis?: boolean }
  | { type: "reply"; reply: BoardroomReply; synthesis?: boolean }
  | { type: "saved"; session: BoardroomSession };

export function cleanAgents(raw: unknown): AgentId[] {
  const list = Array.isArray(raw) ? raw : [];
  return AGENT_IDS.filter((id) => list.includes(id));
}

/** The moderator's brief: every member's answer, then one recommendation. */
export function synthesisPrompt(question: string, replies: BoardroomReply[]): string {
  const answers = replies
    .filter((r) => r.status === "done" && r.text.trim())
    .map((r) => `<answer agent="${r.agent}">\n${r.text.trim().slice(0, 12_000)}\n</answer>`)
    .join("\n\n");
  return `You are chairing a boardroom of AI agents. The user asked:\n\n<question>\n${question}\n</question>\n\nHere is what each agent answered:\n\n${answers}\n\nWrite the board's recommendation in Markdown:\n1. **Consensus** — where the agents agree.\n2. **Disagreements** — where they differ, and who is more convincing and why.\n3. **Recommendation** — the single best course of action, with concrete next steps.\nBe concise. Don't repeat the answers back in full.`;
}

/** Run one agent turn, forwarding deltas. Never throws: errors become an "error" reply. */
async function ask(
  agent: AgentId,
  prompt: string,
  system: string | undefined,
  s: Settings,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<BoardroomReply> {
  const started = Date.now();
  let text = "";
  if (!agentEnabled(agent, s)) return { agent, status: "error", text: "", error: `${AGENTS[agent].name} is disabled in Settings → Agents`, ms: 0 };
  try {
    for await (const ev of AGENTS[agent].chat({ prompt, system, signal, timeoutMs: REPLY_TIMEOUT_MS }, s) as AsyncGenerator<ChatEvent>) {
      if (ev.type === "delta") {
        text += ev.text;
        onDelta(ev.text);
      } else if (ev.type === "done") text = ev.text || text;
      else if (ev.type === "error") return { agent, status: "error", text, error: ev.message, ms: Date.now() - started };
    }
    if (signal.aborted) return { agent, status: "error", text, error: "stopped", ms: Date.now() - started };
    return { agent, status: "done", text: text.trim(), ms: Date.now() - started };
  } catch (e) {
    return { agent, status: "error", text, error: (e as Error).message, ms: Date.now() - started };
  }
}

/** Ask every member at once, then (optionally) have one agent synthesise the answers. */
export async function runBoardroom(
  input: { prompt: string; agents: AgentId[]; synthesizer?: AgentId | null; useMemory: boolean },
  s: Settings,
  signal: AbortSignal,
  send: (ev: BoardroomEvent) => void,
): Promise<BoardroomSession> {
  const session: BoardroomSession = {
    id: newId("br_"),
    prompt: input.prompt,
    ts: Date.now(),
    useMemory: input.useMemory,
    replies: input.agents.map((agent) => ({ agent, status: "running", text: "" })),
  };
  send({ type: "start", session });

  let system: string | undefined;
  if (input.useMemory) {
    const mem = await buildMemoryContext(input.prompt, s);
    system = mem.text || undefined;
    send({ type: "memory", sources: mem.sources });
  }
  const boardNote = `You are one of several AI agents (${input.agents.join(", ")}) answering the same question side by side. Give your own best, independent answer.`;
  const memberSystem = [boardNote, system].filter(Boolean).join("\n\n");

  session.replies = await Promise.all(
    input.agents.map(async (agent) => {
      const reply = await ask(agent, input.prompt, memberSystem, s, signal, (text) => send({ type: "delta", agent, text }));
      send({ type: "reply", reply });
      return reply;
    }),
  );

  const usable = session.replies.filter((r) => r.status === "done" && r.text);
  if (input.synthesizer && usable.length && !signal.aborted) {
    const agent = input.synthesizer;
    send({ type: "reply", reply: { agent, status: "running", text: "" }, synthesis: true });
    session.synthesis = await ask(agent, synthesisPrompt(input.prompt, session.replies), system, s, signal, (text) =>
      send({ type: "delta", agent, text, synthesis: true }),
    );
    send({ type: "reply", reply: session.synthesis, synthesis: true });
  }

  await updateJson<BoardroomSession[]>(BOARDROOM_FILE, [], (l) => [session, ...l].slice(0, MAX_SESSIONS));
  send({ type: "saved", session });
  await logActivity({
    kind: "boardroom",
    title: input.prompt.slice(0, 90),
    detail: `${usable.length} of ${input.agents.length} answered${session.synthesis?.status === "done" ? ` · synthesis by ${session.synthesis.agent}` : ""}`,
    ok: usable.length > 0,
    href: "/boardroom",
  });
  return session;
}
