import type { AgentId, ChatMessage, ChatThread } from "@/lib/types";
import { getAgent } from "@/lib/agents";
import { getSettings } from "@/lib/settings";
import { buildMemoryContext } from "@/lib/vault";
import { newId, readJson, updateJson, writeJson } from "@/lib/store";
import { body, fail, json, ndjson } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const file = (id: string) => `chats/${id}.json`;
const HISTORY_TURNS = 10;

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getAgent(id)) return fail("unknown agent", 404);
  return json(await readJson<ChatThread>(file(id), { messages: [] }));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getAgent(id)) return fail("unknown agent", 404);
  await writeJson(file(id), { messages: [] });
  return json({ ok: true });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return fail("unknown agent", 404);
  const { message, useMemory } = await body<{ message?: string; useMemory?: boolean }>(req);
  const prompt = String(message || "").trim();
  if (!prompt) return fail("message is required");

  const s = await getSettings();
  const thread = await readJson<ChatThread>(file(id), { messages: [] });
  const history = thread.messages
    .filter((m) => !m.error)
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const userMsg: ChatMessage = { id: newId("m_"), role: "user", content: prompt, ts: Date.now(), memory: !!useMemory };
  await updateJson<ChatThread>(file(id), { messages: [] }, (t) => ({ ...t, messages: [...t.messages, userMsg] }));

  return ndjson(async (send) => {
    send({ type: "user", message: userMsg });
    let system: string | undefined;
    if (useMemory) {
      const mem = await buildMemoryContext(prompt, s);
      system = mem.text || undefined;
      send({ type: "memory", sources: mem.sources });
    }

    const started = Date.now();
    let text = "";
    let sessionId = thread.sessionId;
    const tools: string[] = [];
    let error: string | null = null;

    try {
      for await (const ev of agent.chat(
        {
          prompt,
          system,
          history: agent.supportsSessions ? undefined : history,
          sessionId: agent.supportsSessions ? thread.sessionId : undefined,
          signal: req.signal,
        },
        s,
      )) {
        send(ev);
        if (ev.type === "delta") text += ev.text;
        else if (ev.type === "tool") tools.push(ev.name);
        else if (ev.type === "session") sessionId = ev.id;
        else if (ev.type === "done") {
          text = ev.text || text;
          sessionId = ev.sessionId || sessionId;
        } else if (ev.type === "error") error = ev.message;
      }
    } catch (e) {
      error = (e as Error).message;
      send({ type: "error", message: error });
    }

    const aborted = req.signal.aborted;
    const reply: ChatMessage = {
      id: newId("m_"),
      role: "assistant",
      content: error ? (text ? `${text}\n\n` : "") + `⚠ ${error}` : text + (aborted ? "\n\n_(stopped)_" : ""),
      ts: Date.now(),
      ms: Date.now() - started,
      error: !!error,
      tools: tools.length ? [...new Set(tools)] : undefined,
    };
    await updateJson<ChatThread>(file(id), { messages: [] }, (t) => ({
      sessionId: error ? t.sessionId : sessionId,
      messages: [...t.messages, reply],
    }));
    send({ type: "saved", message: reply });
    await logActivity({
      kind: "chat",
      agent: id as AgentId,
      title: prompt.slice(0, 90),
      detail: error ? error.slice(0, 200) : `${Math.round(reply.ms! / 100) / 10}s`,
      ok: !error,
      href: `/${id}`,
    });
  });
}
