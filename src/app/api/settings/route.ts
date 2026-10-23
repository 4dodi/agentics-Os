import { getPublicSettings, saveSettings } from "@/lib/settings";
import { body, json } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getPublicSettings());
}

export async function PUT(req: Request) {
  const patch = await body(req);
  await saveSettings(patch);
  await logActivity({ kind: "system", title: "Settings updated", detail: Object.keys(patch).join(", ") });
  return json(await getPublicSettings());
}
