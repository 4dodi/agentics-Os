import { listActivity } from "@/lib/activity";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(500, Number(u.searchParams.get("limit") || 50));
  const since = Number(u.searchParams.get("since") || 0) || undefined;
  const until = Number(u.searchParams.get("until") || 0) || undefined;
  return json(await listActivity(limit, since, until));
}
