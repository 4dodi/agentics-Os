import { test } from "node:test";
import assert from "node:assert/strict";
import { splitArgs, templateArgs, stripAnsi } from "../src/lib/proc";
import { cleanTranscript, parseArticle, slugify, stripActiveContent, wordCount } from "../src/lib/seo";
import { findMediaRefs } from "../src/lib/studio";
import { extractLinks, resolveInVault } from "../src/lib/vault";
import { cleanCliOutput } from "../src/lib/agents/hermes";
import { flattenPrompt } from "../src/lib/agents/base";

test("splitArgs honours quotes and escapes", () => {
  assert.deepEqual(splitArgs(`chat -q "hello world" --x 'a b' c\\ d ""`), ["chat", "-q", "hello world", "--x", "a b", "c d", ""]);
});

test("templateArgs substitutes per token without shell parsing", () => {
  const evil = `"; rm -rf / #`;
  assert.deepEqual(templateArgs("agent --agent {agent} --message {prompt}", { prompt: evil, agent: "main" }), ["agent", "--agent", "main", "--message", evil]);
});

test("stripAnsi removes colour codes", () => {
  assert.equal(stripAnsi("\x1b[32mok\x1b[0m"), "ok");
});

test("parseArticle reads front matter and drops preamble", () => {
  const a = parseArticle("Sure! Here you go:\n---\ntitle: \"Pi vs OpenClaw\"\ndescription: Short desc\n---\n# Pi vs OpenClaw\n\nBody text.", "pi vs openclaw");
  assert.equal(a.title, "Pi vs OpenClaw");
  assert.equal(a.description, "Short desc");
  assert.match(a.markdown, /^# Pi vs OpenClaw/);
});

test("parseArticle falls back to H1 and first paragraph, unwraps code fences", () => {
  const a = parseArticle("```markdown\n# Title Here\n\nFirst paragraph is the description.\n\n## Next\n```", "kw");
  assert.equal(a.title, "Title Here");
  assert.equal(a.description, "First paragraph is the description.");
});

test("parseArticle adds an H1 when missing", () => {
  const a = parseArticle("---\ntitle: T\ndescription: D\n---\nJust body.", "kw");
  assert.match(a.markdown, /^# T\n\nJust body\./);
});

test("cleanTranscript strips SRT/VTT and YouTube timestamps", () => {
  const srt = "1\n00:00:01,000 --> 00:00:03,000\nHello there\n\n2\n00:00:03,000 --> 00:00:05,000\nGeneral Kenobi";
  assert.equal(cleanTranscript(srt).replace(/\s+/g, " "), "Hello there General Kenobi");
  assert.equal(cleanTranscript("0:08\n8 seconds how to automate").trim(), "how to automate");
});

test("slugify and wordCount", () => {
  assert.equal(slugify("Pi vs OpenClaw — Café!"), "pi-vs-openclaw-cafe");
  assert.equal(wordCount("# Hello world\n\n- one two"), 4);
});

test("stripActiveContent removes scripts, handlers and javascript: urls", () => {
  const out = stripActiveContent(`<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="//e"></iframe>`);
  assert.equal(out, `<p>hi</p><a href="#">x</a>`);
});

test("findMediaRefs finds paths, encoded app links and URLs", () => {
  const text = `Saved to /Users/j/Downloads/cyberpunk cat.mp4\nAlso http://localhost:3737/api/media/file?path=%2Ftmp%2Fa.mp4 and https://cdn.x.ai/v.mp4?sig=1`;
  const refs = findMediaRefs(text, "video");
  assert.ok(refs.includes("/Users/j/Downloads/cyberpunk cat.mp4"), JSON.stringify(refs));
  assert.ok(refs.includes("/tmp/a.mp4"));
  assert.ok(refs.includes("https://cdn.x.ai/v.mp4?sig=1"));
  assert.deepEqual(findMediaRefs("MEDIA:/tmp/out.png", "image"), ["/tmp/out.png"]);
});

test("extractLinks handles aliases, headings and embeds", () => {
  assert.deepEqual(extractLinks("[[A]] [[B|alias]] [[C#Heading]] ![[img.png]]"), ["A", "B", "C", "img.png"]);
});

test("resolveInVault refuses traversal", () => {
  assert.throws(() => resolveInVault("/vault", "../etc/passwd"));
  assert.throws(() => resolveInVault("/vault", "/../../etc"));
  assert.equal(resolveInVault("/vault", "Notes/a.md"), "/vault/Notes/a.md");
});

test("cleanCliOutput strips box chrome but keeps content", () => {
  assert.equal(cleanCliOutput("╭──────╮\n│ Hello │\n╰──────╯").trim(), "Hello");
});

test("flattenPrompt includes system, history and prompt", () => {
  const p = flattenPrompt({ prompt: "now", system: "SYS", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] });
  assert.match(p, /^SYS[\s\S]*User: hi[\s\S]*You: yo[\s\S]*now$/);
});
