import { getSettings } from "@/lib/settings";
import { searchConsoleReport } from "@/lib/gsc";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Search Console clicks per day for each site. ?days=7..90, ?fresh=1 skips the 15-minute cache. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const days = Math.max(7, Math.min(90, Number(u.searchParams.get("days")) || 28));
  const s = await getSettings();
  if (!s.seo.gscServiceAccount) return json({ configured: false, sites: [] });
  try {
    return json({ configured: true, days, sites: await searchConsoleReport(s, days, u.searchParams.get("fresh") === "1") });
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
