import type { Goal } from "@/lib/types";
import { newId, readJson, updateJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { withProgress } from "@/lib/goals";
import { withSpec } from "@/lib/automations";

export const dynamic = "force-dynamic";
const FILE = "goals.json";

export async function GET() {
  return json(await readJson<Goal[]>(FILE, []));
}

export async function POST(req: Request) {
  const b = await body<Partial<Goal>>(req);
  if (!b.title?.trim()) return fail("title is required");
  const now = Date.now();
  let goal: Goal = {
    id: newId("g_"),
    title: b.title.trim(),
    why: b.why || "",
    kind: b.kind === "automation" ? "automation" : "goal",
    target: b.target || "",
    status: "active",
    progress: 0,
    milestones: (Array.isArray(b.milestones) ? b.milestones : []).map((m) => ({ id: newId("ms_"), text: String(m?.text ?? ""), done: !!m?.done })),
    createdAt: now,
    updatedAt: now,
  };
  if (goal.kind === "automation") goal = withSpec(goal, b.automation ?? {}, now);
  await updateJson<Goal[]>(FILE, [], (l) => [goal, ...l]);
  await logActivity({ kind: "goal", title: `New ${goal.kind}: ${goal.title}`, href: "/goals" });
  return json(goal);
}

export async function PATCH(req: Request) {
  const b = await body<Partial<Goal>>(req);
  if (!b.id) return fail("id is required");
  let out: Goal | undefined;
  let completed = false;
  await updateJson<Goal[]>(FILE, [], (l) =>
    l.map((g) => {
      if (g.id !== b.id) return g;
      const milestones = b.milestones?.map((m) => ({ id: m.id || newId("ms_"), text: m.text, done: !!m.done })) ?? g.milestones;
      // Only user-editable fields are taken from the request; ids and timestamps stay ours.
      const edit: Partial<Goal> = {};
      if (typeof b.title === "string" && b.title.trim()) edit.title = b.title.trim();
      if (typeof b.why === "string") edit.why = b.why;
      if (typeof b.target === "string") edit.target = b.target;
      if (b.kind === "goal" || b.kind === "automation") edit.kind = b.kind;
      if (b.status === "active" || b.status === "done" || b.status === "paused") edit.status = b.status;
      if (typeof b.progress === "number" && Number.isFinite(b.progress)) edit.progress = Math.max(0, Math.min(100, Math.round(b.progress)));
      out = withProgress({ ...g, ...edit, milestones, updatedAt: Date.now() } as Goal);
      if (out.kind === "automation" && (b.automation !== undefined || !out.automation)) out = withSpec(out, b.automation ?? {});
      if (out.milestones.length && out.progress === 100 && g.status !== "done" && b.status === undefined) out.status = "done";
      completed = out.status === "done" && g.status !== "done";
      return out;
    }),
  );
  if (!out) return fail("not found", 404);
  if (completed) await logActivity({ kind: "goal", title: `Completed: ${out.title}`, ok: true, href: "/goals" });
  return json(out);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  await updateJson<Goal[]>(FILE, [], (l) => l.filter((g) => g.id !== id));
  return json({ ok: true });
}
