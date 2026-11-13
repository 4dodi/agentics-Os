import { getSettings } from "@/lib/settings";
import { listRuns, startRun } from "@/lib/automations";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Recent automation runs, optionally for one goal (?goalId=). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(300, Number(u.searchParams.get("limit") || 50) || 50);
  return json(await listRuns(u.searchParams.get("goalId") || undefined, limit));
}

/** { id } runs that automation now, in the background. */
export async function POST(req: Request) {
  const { id } = await body<{ id?: string }>(req);
  if (!id) return fail("id is required");
  try {
    return json(await startRun(String(id), "manual", await getSettings()));
  } catch (e) {
    return fail((e as Error).message);
  }
}
