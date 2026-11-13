import type { AgentId, KanbanCard } from "@/lib/types";
import { getAgent, complete } from "@/lib/agents";
import { getSettings } from "@/lib/settings";
import { buildMemoryContext } from "@/lib/vault";
import { newId, readJson, updateJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
const FILE = "kanban.json";

export async function GET(req: Request) {
  const agent = new URL(req.url).searchParams.get("agent");
  const cards = await readJson<KanbanCard[]>(FILE, []);
  return json(agent ? cards.filter((c) => c.agent === agent) : cards);
}

export async function POST(req: Request) {
  const b = await body<{ agent?: string; text?: string; run?: string }>(req);
  // { run: id } executes an existing card in the background.
  if (b.run) return runCard(b.run);
  if (!b.agent || !getAgent(b.agent) || !b.text?.trim()) return fail("agent and text are required");
  const card: KanbanCard = { id: newId("k_"), agent: b.agent as AgentId, text: b.text.trim(), column: "todo", createdAt: Date.now() };
  await updateJson<KanbanCard[]>(FILE, [], (l) => [...l, card]);
  return json(card);
}

export async function PATCH(req: Request) {
  const b = await body<Partial<KanbanCard> & { id?: string }>(req);
  if (!b.id) return fail("id is required");
  if (b.column && !["todo", "doing", "done"].includes(b.column)) return fail("column must be todo, doing or done");
  let updated: KanbanCard | undefined;
  await updateJson<KanbanCard[]>(FILE, [], (l) =>
    l.map((c) => (c.id === b.id ? (updated = { ...c, ...(b.column ? { column: b.column } : {}), ...(b.text ? { text: b.text } : {}) }) : c)),
  );
  return updated ? json(updated) : fail("not found", 404);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  await updateJson<KanbanCard[]>(FILE, [], (l) => l.filter((c) => c.id !== id));
  return json({ ok: true });
}

async function runCard(id: string) {
  const cards = await readJson<KanbanCard[]>(FILE, []);
  const card = cards.find((c) => c.id === id);
  if (!card) return fail("not found", 404);
  const set = (patch: Partial<KanbanCard>) => updateJson<KanbanCard[]>(FILE, [], (l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  await set({ column: "doing", result: undefined, error: false });
  void (async () => {
    const s = await getSettings();
    try {
      const mem = s.vault.injectByDefault ? await buildMemoryContext(card.text, s) : { text: "" };
      const out = await complete(card.agent, { prompt: card.text, system: mem.text || undefined }, s);
      await set({ column: "done", result: out });
      await logActivity({ kind: "chat", agent: card.agent, title: `Task done: ${card.text.slice(0, 80)}`, ok: true, href: `/${card.agent}` });
    } catch (e) {
      await set({ column: "todo", result: (e as Error).message, error: true });
      await logActivity({ kind: "chat", agent: card.agent, title: `Task failed: ${card.text.slice(0, 80)}`, ok: false });
    }
  })();
  return json({ ok: true });
}
