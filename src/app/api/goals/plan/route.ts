import type { AgentId, Goal } from "@/lib/types";
import { complete, getAgent } from "@/lib/agents";
import { getSettings } from "@/lib/settings";
import { buildMemoryContext } from "@/lib/vault";
import { newId, readJson, updateJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";
import { withProgress } from "@/lib/goals";

export const dynamic = "force-dynamic";

/** Ask an agent to break a goal into milestones, using memory so the plan fits the user. */
export async function POST(req: Request) {
  const { id, agent } = await body<{ id?: string; agent?: string }>(req);
  const goals = await readJson<Goal[]>("goals.json", []);
  const goal = goals.find((g) => g.id === id);
  if (!goal) return fail("goal not found", 404);
  const agentId = (agent && getAgent(agent) ? agent : "claude") as AgentId;
  const s = await getSettings();
  const mem = await buildMemoryContext(`${goal.title} ${goal.why}`, s);
  const prompt =
    goal.kind === "automation"
      ? `I want to set up this automation with my AI agents this week: "${goal.title}". ${goal.why ? `Why: ${goal.why}.` : ""}\nBreak it into 3-6 concrete steps (implement, test, refine). Reply ONLY with a markdown checklist, one "- [ ] step" per line.`
      : `My goal: "${goal.title}". ${goal.why ? `Why: ${goal.why}.` : ""} ${goal.target ? `Target date: ${goal.target}.` : ""}\nBreak it into 3-7 concrete, measurable milestones in order, including at least one I could hand to an AI agent. Reply ONLY with a markdown checklist, one "- [ ] milestone" per line.`;
  let out: string;
  try {
    out = await complete(agentId, { prompt, system: mem.text || undefined }, s);
  } catch (e) {
    return fail(`${agentId}: ${(e as Error).message}`, 502);
  }
  const steps = out
    .split("\n")
    .map((l) => l.match(/^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s+)(.+)$/)?.[1]?.trim())
    .filter((t): t is string => !!t && t.length > 2)
    .slice(0, 10);
  if (!steps.length) return fail(`Couldn't read a checklist from the reply:\n${out.slice(0, 400)}`, 502);
  let updated: Goal | undefined;
  await updateJson<Goal[]>("goals.json", [], (l) =>
    l.map((g) =>
      g.id === goal.id
        ? (updated = withProgress({
            ...g,
            milestones: [...g.milestones, ...steps.map((text) => ({ id: newId("ms_"), text, done: false }))],
            status: g.status === "done" ? "active" : g.status,
            updatedAt: Date.now(),
          }))
        : g,
    ),
  );
  return json(updated);
}
