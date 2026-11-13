import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanSpec, describeSchedule, nextRun } from "../src/lib/automations";
import { appendToSection } from "../src/lib/journal";
import { formatConversation, marker, writeConversations, type OmiConversation } from "../src/lib/omi";
import { fillDays, parseServiceAccount, signJwt } from "../src/lib/gsc";
import { cleanAgents, synthesisPrompt } from "../src/lib/boardroom";
import { cleanVaultFolder, defaultSettings } from "../src/lib/settings";
import { niceMax, fmtNum } from "../src/app/seo/ClicksChart";

// ---------------------------------------------------------------- automations

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test("nextRun: daily, weekly and hourly slots are strictly in the future", () => {
  // 2026-11-13 is a Friday.
  const fri10 = at(2026, 11, 13, 10, 0);
  assert.equal(nextRun({ every: "day", weekday: 0, time: "09:00" }, fri10), at(2026, 11, 14, 9, 0));
  assert.equal(nextRun({ every: "day", weekday: 0, time: "11:30" }, fri10), at(2026, 11, 13, 11, 30));
  assert.equal(nextRun({ every: "week", weekday: 1, time: "09:00" }, fri10), at(2026, 11, 16, 9, 0)); // next Monday
  assert.equal(nextRun({ every: "week", weekday: 5, time: "09:00" }, fri10), at(2026, 11, 20, 9, 0)); // Friday already passed
  assert.equal(nextRun({ every: "week", weekday: 5, time: "10:00" }, fri10), at(2026, 11, 20, 10, 0)); // exactly now → next week
  assert.equal(nextRun({ every: "hour", weekday: 0, time: "00:15" }, fri10), at(2026, 11, 13, 10, 15));
  assert.equal(nextRun({ every: "hour", weekday: 0, time: "00:00" }, fri10), at(2026, 11, 13, 11, 0));
});

test("cleanSpec validates agent, schedule and time", () => {
  const s = cleanSpec({ agent: "rm -rf", every: "minute", weekday: 9, time: "25:99", prompt: 42, enabled: "yes" });
  assert.deepEqual([s.agent, s.every, s.weekday, s.time, s.prompt, s.enabled], ["claude", "week", 1, "23:59", "", false]);
  const ok = cleanSpec({ agent: "hermes", every: "day", time: "7:05", prompt: "hi", enabled: true });
  assert.deepEqual([ok.agent, ok.every, ok.time, ok.enabled], ["hermes", "day", "07:05", true]);
  assert.equal(describeSchedule({ every: "week", weekday: 1, time: "09:00" }), "every Monday at 09:00");
});

test("appendToSection adds to an existing section or creates it", () => {
  const base = "# Day\n\n## Log\n- 09:00 a\n\n## Notes\nx\n";
  assert.equal(appendToSection(base, "Log", "- 10:00 b"), "# Day\n\n## Log\n- 09:00 a\n- 10:00 b\n## Notes\nx\n");
  assert.match(appendToSection(base, "Automations", "### Report\nok"), /## Notes\nx\n\n## Automations\n### Report\nok\n$/);
});

// ---------------------------------------------------------------- OMI

const conv = (id: string, started: string, extra: Partial<OmiConversation> = {}): OmiConversation => ({
  id,
  started_at: started,
  finished_at: started,
  structured: { title: "Feature Discussion", overview: "Brainstorm\n# not a heading -->", emoji: "💼", category: "business", action_items: [{ description: "Mockups", completed: false }] },
  transcript_segments: [{ text: "Let's go", speaker_name: "John" }, { text: "Sure", is_user: true }],
  ...extra,
});

test("formatConversation renders title, overview, action items and an optional transcript", () => {
  const md = formatConversation(conv("c1", "2026-11-13T09:00:00Z"), true);
  assert.match(md, /^## 💼 Feature Discussion\n<!-- omi:c1 -->/);
  assert.match(md, /- \[ \] Mockups/);
  assert.match(md, /> \*\*John:\*\* Let's go\n> \*\*Me:\*\* Sure/);
  assert.doesNotMatch(md.split("\n").slice(2).join("\n"), /^#{1,2} |-->/m, "user text can't add top-level headings or close the marker");
  assert.doesNotMatch(formatConversation(conv("c1", "2026-11-13T09:00:00Z"), false), /Transcript/);
  assert.equal(marker('x"><b'), "<!-- omi:xb -->");
});

test("writeConversations groups by day and never duplicates on re-import", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "aos-omi-"));
  const s = defaultSettings();
  s.vault.path = base;
  const list = [conv("a", "2026-11-12T10:00:00"), conv("b", "2026-11-13T10:00:00"), conv("c", "2026-11-13T11:00:00"), conv("d", "2026-11-13T12:00:00", { discarded: true })];
  const first = await writeConversations(list, s);
  assert.deepEqual([first.added, first.skipped, first.notes.length], [3, 0, 2]);
  const again = await writeConversations(list, s);
  assert.deepEqual([again.added, again.skipped, again.notes.length], [0, 3, 0]);
  const day = await fs.readFile(path.join(base, "OMI", "OMI 2026-11-13.md"), "utf8");
  assert.equal(day.match(/<!-- omi:/g)?.length, 2);
  assert.match(day, /^# OMI · Friday, November 13, 2026/);
  await fs.rm(base, { recursive: true, force: true });
});

test("cleanVaultFolder keeps names and drops traversal", () => {
  assert.equal(cleanVaultFolder("Memory/OMI", "OMI"), "Memory/OMI");
  assert.equal(cleanVaultFolder("../../etc", "OMI"), "etc");
  assert.equal(cleanVaultFolder("..", "OMI"), "OMI");
});

// ---------------------------------------------------------------- Search Console

test("service-account JWT is RS256-signed and verifiable", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = parseServiceAccount(JSON.stringify({ client_email: "bot@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }));
  const jwt = signJwt(sa, 1_000);
  const [h, c, sig] = jwt.split(".");
  assert.ok(crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url")));
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.deepEqual([claims.iss, claims.exp - claims.iat, claims.scope], ["bot@p.iam.gserviceaccount.com", 3600, "https://www.googleapis.com/auth/webmasters.readonly"]);
  assert.throws(() => parseServiceAccount("{}"), /client_email/);
  assert.throws(() => parseServiceAccount("nope"), /JSON/);
});

test("fillDays zero-fills missing dates", () => {
  const d = fillDays([{ keys: ["2026-11-02"], clicks: 4.4, impressions: 10 }], "2026-11-01", "2026-11-03");
  assert.deepEqual(d.map((x) => [x.date, x.clicks]), [["2026-11-01", 0], ["2026-11-02", 4], ["2026-11-03", 0]]);
});

test("chart axis helpers", () => {
  assert.deepEqual([niceMax(0), niceMax(7), niceMax(13), niceMax(240), niceMax(1000)], [1, 10, 20, 500, 1000]);
  assert.deepEqual([fmtNum(950), fmtNum(9999), fmtNum(12_900), fmtNum(240_000)], ["950", "9,999", "12.9K", "240K"]);
});

// ---------------------------------------------------------------- Boardroom

test("boardroom: agent list is validated and the chair sees every finished answer", () => {
  assert.deepEqual(cleanAgents(["hermes", "evil", "claude", "claude"]), ["claude", "hermes"]);
  assert.deepEqual(cleanAgents("claude"), []);
  const p = synthesisPrompt("Q?", [
    { agent: "claude", status: "done", text: "A" },
    { agent: "hermes", status: "error", text: "", error: "x" },
    { agent: "openclaw", status: "done", text: "B" },
  ]);
  assert.match(p, /<answer agent="claude">\nA\n<\/answer>/);
  assert.match(p, /<answer agent="openclaw">\nB\n<\/answer>/);
  assert.doesNotMatch(p, /hermes/);
});
