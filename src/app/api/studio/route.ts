import type { StudioItem } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { STUDIO_FILE, saveToVault, startStudio } from "@/lib/studio";
import { readJson, updateJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";
const KINDS = ["image", "video", "speech"] as const;

export async function GET() {
  return json(await readJson<StudioItem[]>(STUDIO_FILE, []));
}

/** { kind, prompt } starts a generation; { action: "vault", id } saves a result into the vault. */
export async function POST(req: Request) {
  const b = await body<{ kind?: string; prompt?: string; action?: string; id?: string }>(req);
  const s = await getSettings();
  if (b.action === "vault") {
    try {
      return json({ note: await saveToVault(String(b.id), s) });
    } catch (e) {
      return fail((e as Error).message);
    }
  }
  if (!KINDS.includes(b.kind as (typeof KINDS)[number])) return fail("kind must be image, video or speech");
  if (!b.prompt?.trim()) return fail("prompt is required");
  return json(await startStudio(b.kind as StudioItem["kind"], b.prompt.trim(), s));
}

/** ?id= removes one item, ?kind= clears a tab. Files on disk are kept. */
export async function DELETE(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  const kind = u.searchParams.get("kind");
  await updateJson<StudioItem[]>(STUDIO_FILE, [], (l) => l.filter((x) => (id ? x.id !== id : kind ? x.kind !== kind : false)));
  return json({ ok: true });
}
