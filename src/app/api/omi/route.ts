import { getSettings } from "@/lib/settings";
import { OMI_STATE, importFromOmi, importOmiJson, type OmiState } from "@/lib/omi";
import { readJson } from "@/lib/store";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSettings();
  const state = await readJson<OmiState>(OMI_STATE, {});
  return json({ configured: Boolean(s.omi.apiKey), autoImport: s.omi.autoImport, folder: s.omi.folder, ...state });
}

/** { action: "import", sinceDays? } pulls from the OMI API; { action: "json", data } imports an export file. */
export async function POST(req: Request) {
  const b = await body<{ action?: string; sinceDays?: number; data?: string }>(req);
  const s = await getSettings();
  try {
    if (b.action === "json") {
      if (typeof b.data !== "string" || !b.data.trim()) return fail("data is required");
      if (b.data.length > 20_000_000) return fail("file is too large (20 MB max)");
      return json(await importOmiJson(b.data, s));
    }
    if (b.action === "import") {
      const days = Number(b.sinceDays);
      return json(await importFromOmi(s, { sinceDays: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : undefined }));
    }
    return fail("action must be import or json");
  } catch (e) {
    return fail((e as Error).message, 502);
  }
}
