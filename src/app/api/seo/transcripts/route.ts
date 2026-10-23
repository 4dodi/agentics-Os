import type { Transcript } from "@/lib/types";
import { TRANSCRIPTS, cleanTranscript } from "@/lib/seo";
import { newId, readJson, updateJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await readJson<Transcript[]>(TRANSCRIPTS, []));
}

export async function POST(req: Request) {
  const b = await body<{ title?: string; text?: string }>(req);
  const text = cleanTranscript(String(b.text || ""));
  if (!text) return fail("text is required");
  const t: Transcript = {
    id: newId("t_"),
    title: String(b.title || "").trim() || text.slice(0, 60),
    text,
    words: (text.match(/\S+/g) || []).length,
    createdAt: Date.now(),
  };
  await updateJson<Transcript[]>(TRANSCRIPTS, [], (l) => [t, ...l]);
  return json(t);
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  await updateJson<Transcript[]>(TRANSCRIPTS, [], (l) => l.filter((t) => t.id !== id));
  return json({ ok: true });
}
