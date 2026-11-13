import type { AgentId } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { ensureVault, listNotes, readNote, writeNote } from "@/lib/vault";
import { listActivity, logActivity } from "@/lib/activity";
import { complete, getAgent } from "@/lib/agents";
import { body, fail, json } from "@/lib/http";
import { JOURNAL_DIR as DIR, appendToSection, isDate, journalTemplate as template } from "@/lib/journal";

export const dynamic = "force-dynamic";

function dayBounds(date: string, tzOffsetMin: number) {
  // date is the user's local calendar day; tzOffsetMin is Date#getTimezoneOffset() from the browser.
  const start = Date.parse(`${date}T00:00:00Z`) + tzOffsetMin * 60_000;
  return { start, end: start + 86_400_000 };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const date = u.searchParams.get("date") || "";
  const tz = Number(u.searchParams.get("tz") || 0);
  if (!isDate(date)) return fail("date=YYYY-MM-DD is required");
  const root = await ensureVault(await getSettings());
  const content = await readNote(root, `${DIR}/${date}.md`).catch(() => null);
  const notes = await listNotes(root);
  const dates = notes
    .filter((n) => n.folder === DIR && isDate(n.title))
    .map((n) => n.title)
    .sort()
    .reverse()
    .slice(0, 60);
  const { start, end } = dayBounds(date, tz);
  const activity = await listActivity(300, start, end);
  return json({ date, exists: content !== null, content: content ?? template(date), dates, activity });
}

export async function PUT(req: Request) {
  const { date, content } = await body<{ date?: string; content?: string }>(req);
  if (!isDate(date)) return fail("date is required");
  const root = await ensureVault(await getSettings());
  await writeNote(root, `${DIR}/${date}.md`, String(content ?? ""));
  return json({ ok: true });
}

/** { date, text, time } appends a log line; { date, action: "reflect", agent, tz } asks an agent to reflect on the day. */
export async function POST(req: Request) {
  const b = await body<{ date?: string; text?: string; time?: string; action?: string; agent?: string; tz?: number }>(req);
  if (!isDate(b.date)) return fail("date is required");
  const s = await getSettings();
  const root = await ensureVault(s);
  const rel = `${DIR}/${b.date}.md`;
  let content = (await readNote(root, rel).catch(() => null)) ?? template(b.date);

  if (b.action === "reflect") {
    const agentId = (b.agent && getAgent(b.agent) ? b.agent : "claude") as AgentId;
    const { start, end } = dayBounds(b.date, Number(b.tz || 0));
    const activity = await listActivity(200, start, end);
    const log = activity.map((a) => `- ${new Date(a.ts).toISOString().slice(11, 16)} [${a.kind}] ${a.title}${a.ok === false ? " (failed)" : ""}`).join("\n");
    const prompt = `Here is my journal for ${b.date} and what my agents did today.\n\n<journal>\n${content}\n</journal>\n\n<agent_activity>\n${log || "(none)"}\n</agent_activity>\n\nWrite a short reflection (max 150 words) in markdown bullet points: what got done, what's blocked, and the single most valuable thing to do tomorrow. Reply with only the bullets.`;
    try {
      const out = await complete(agentId, { prompt }, s);
      content = content.trimEnd() + `\n\n## Reflection (${agentId})\n${out.trim()}\n`;
    } catch (e) {
      return fail(`${agentId}: ${(e as Error).message}`, 502);
    }
  } else {
    const text = String(b.text || "").trim();
    if (!text) return fail("text is required");
    const line = `- ${b.time || new Date().toTimeString().slice(0, 5)} ${text}`;
    content = appendToSection(content, "Log", line);
    await logActivity({ kind: "journal", title: text.slice(0, 90), href: `/journal?date=${b.date}` });
  }
  await writeNote(root, rel, content);
  return json({ ok: true, content });
}
