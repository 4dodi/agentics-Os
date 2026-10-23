import { DEFAULT_SKILL, getSkill, saveSkill } from "@/lib/seo";
import { body, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const content = await getSkill();
  return json({ content, isDefault: content === DEFAULT_SKILL });
}

export async function PUT(req: Request) {
  const { content } = await body<{ content?: string }>(req);
  await saveSkill(String(content ?? ""));
  return json({ ok: true });
}

export async function DELETE() {
  await saveSkill(null);
  return json({ content: DEFAULT_SKILL, isDefault: true });
}
