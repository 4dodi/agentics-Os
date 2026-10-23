import { buildMemoryContext } from "@/lib/vault";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Preview exactly what memory block an agent would receive for a given prompt. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  return json(await buildMemoryContext(q));
}
