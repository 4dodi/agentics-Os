import type { AgentId, BoardroomSession } from "@/lib/types";
import { BOARDROOM_FILE, cleanAgents, runBoardroom } from "@/lib/boardroom";
import { getSettings } from "@/lib/settings";
import { readJson, updateJson } from "@/lib/store";
import { body, fail, json, ndjson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await readJson<BoardroomSession[]>(BOARDROOM_FILE, []));
}

/** { prompt, agents: [...], synthesizer?, useMemory } streams every agent's answer (NDJSON), then the synthesis. */
export async function POST(req: Request) {
  const b = await body<{ prompt?: string; agents?: unknown; synthesizer?: string | null; useMemory?: boolean }>(req);
  const prompt = String(b.prompt || "").trim();
  if (!prompt) return fail("prompt is required");
  const agents = cleanAgents(b.agents);
  if (!agents.length) return fail("pick at least one agent");
  const synthesizer = cleanAgents([b.synthesizer])[0] ?? null;
  const s = await getSettings();
  return ndjson(async (send) => {
    await runBoardroom({ prompt, agents, synthesizer: synthesizer as AgentId | null, useMemory: b.useMemory !== false }, s, req.signal, send);
  });
}

/** ?id= removes one session; no id clears the history. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  await updateJson<BoardroomSession[]>(BOARDROOM_FILE, [], (l) => (id ? l.filter((x) => x.id !== id) : []));
  return json({ ok: true });
}
