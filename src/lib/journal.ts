import type { Settings } from "./types";
import { ensureVault, readNote, writeNote } from "./vault";

export const JOURNAL_DIR = "Journal";

export function isDate(d: unknown): d is string {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/** Today's date in the server's local time zone, as YYYY-MM-DD. */
export function localDate(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function journalTemplate(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const label = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `# ${label}\n\n## Focus\n- \n\n## Log\n`;
}

/** Add `block` at the end of the `## <section>` section, creating the section if needed. */
export function appendToSection(content: string, section: string, block: string): string {
  const esc = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## ${esc}\\s*$`, "m");
  if (!heading.test(content)) return content.trimEnd() + `\n\n## ${section}\n${block.trimEnd()}\n`;
  return content.replace(new RegExp(`(^## ${esc}\\s*\\n(?:(?!^## ).*\\n?)*)`, "m"), (sec) => sec.trimEnd() + "\n" + block.trimEnd() + "\n");
}

/** Append a block to a section of a day's journal note (today by default). */
export async function appendToJournal(s: Settings, section: string, block: string, date = localDate()): Promise<string> {
  const root = await ensureVault(s);
  const rel = `${JOURNAL_DIR}/${date}.md`;
  const content = (await readNote(root, rel).catch(() => null)) ?? journalTemplate(date);
  const next = appendToSection(content, section, block);
  await writeNote(root, rel, next);
  return next;
}
