import type { SeoSession } from "@/lib/types";
import { SESSIONS, startGeneration, withLive, type GenerateInput } from "@/lib/seo";
import { getSettings } from "@/lib/settings";
import { readJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const list = (await readJson<SeoSession[]>(SESSIONS, [])).map(withLive);
  if (id) {
    const one = list.find((s) => s.id === id);
    return one ? json(one) : fail("not found", 404);
  }
  return json(list);
}

/** Start a generation session; it runs in the background and is polled via GET ?id= */
export async function POST(req: Request) {
  const input = await body<GenerateInput>(req);
  try {
    return json(await startGeneration(input, await getSettings()));
  } catch (e) {
    return fail((e as Error).message);
  }
}
