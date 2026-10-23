import type { Goal } from "@/lib/types";
import { newId, readJson, updateJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { withProgress } from "@/lib/goals";

export const dynamic = "force-dynamic";
const FILE = "goals.json";

export async function GET() {
  return json(await readJson<Goal[]>(FILE, []));
}

export async function POST(req: Request) {
  const b = await body<Partial<Goal>>(req);
  if (!b.title?.trim()) return fail("title is required");
  const now = Date.now();
  const goal: Goal = {
    id: newId("g_"),
    title: b.title.trim(),
    why: b.why || "",
    kind: b.kind === "automation" ? "automation" : "goal",
    target: b.target || "",
    status: "active",
    progress: 0,
    milestones: (b.milestones || []).map((m) => ({ id: newId("ms_"), text: m.text, done: !!m.done })),
    createdAt: now,
    updatedAt: now,
  };
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
      out = withProgress({ ...g, ...b, milestones, id: g.id, createdAt: g.createdAt, updatedAt: Date.now() } as Goal);
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
