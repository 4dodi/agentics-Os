import { getSettings } from "@/lib/settings";
import { listNetlifySites } from "@/lib/netlify";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Lets Settings pick site ids instead of copy-pasting them. */
export async function GET() {
  const s = await getSettings();
  if (!s.seo.netlifyToken) return fail("No Netlify token configured");
  try {
    return json(await listNetlifySites(s.seo.netlifyToken));
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
