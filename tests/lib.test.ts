import { test } from "node:test";
import assert from "node:assert/strict";
import { splitArgs, templateArgs, stripAnsi } from "../src/lib/proc";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanTranscript, parseArticle, renderMarkdown, safeUrl, slugify, stripActiveContent, wordCount } from "../src/lib/seo";
import { cleanBlogPath, cleanColor, cleanDomain, normaliseSite } from "../src/lib/settings";
import { checkRequest } from "../src/proxy";
import { findMediaRefs } from "../src/lib/studio";
import { extractLinks, readNote, resolveInVault, writeNote } from "../src/lib/vault";
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

// ---------------------------------------------------------------- security hardening

test("stripActiveContent catches slash-separated handlers, unquoted javascript: and nesting", () => {
  assert.equal(stripActiveContent(`<img/onerror=alert(1) src=x>`), `<img/ src=x>`);
  assert.equal(stripActiveContent(`<a href=javascript:alert(1)>x</a>`), `<a href="#">x</a>`);
  assert.doesNotMatch(stripActiveContent(`<scr<script>ipt>alert(1)</script>`), /<script/i);
  assert.doesNotMatch(stripActiveContent(`<svg><animate onbegin=alert(1)></svg><form action="javascript:x"></form>`), /svg|form|onbegin|javascript/i);
});

test("renderMarkdown escapes raw HTML and drops dangerous URLs", () => {
  const html = renderMarkdown(
    [
      `<script>alert(1)</script>`,
      `<img src=x onerror=alert(1)>`,
      `[click](javascript:alert(1)) [tab](java\tscript:alert(1)) [data](data:text/html,<b>x</b>)`,
      `![pic](javascript:alert(1)) ![ok](/img/a.png)`,
      `[good](https://example.com/a?b=1) [rel](/blog/x/) [mail](mailto:a@b.c)`,
    ].join("\n\n"),
  );
  assert.doesNotMatch(html, /<script|<img src="?x|onerror=|href="(javascript|java\s*script|data):/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1" rel="noopener nofollow">good<\/a>/);
  assert.match(html, /<a href="\/blog\/x\/">rel<\/a>/);
  assert.match(html, /<a href="mailto:a@b\.c">mail<\/a>/);
  assert.match(html, /<img src="\/img\/a\.png" alt="ok"/);
});

test("safeUrl allows only http(s), mailto and relative URLs", () => {
  for (const ok of ["https://x.y", "http://x.y", "mailto:a@b.c", "/a", "#top", "a/b", "//cdn.x"]) assert.ok(safeUrl(ok), ok);
  for (const bad of ["javascript:x", " JaVaScRiPt:x", "java\nscript:x", "vbscript:x", "data:text/html,x", "file:///etc/passwd"])
    assert.equal(safeUrl(bad), null, bad);
});

test("site fields are cleaned before they reach HTML, CSS or the filesystem", () => {
  assert.equal(cleanDomain("https://Example.com/path?q"), "example.com");
  assert.equal(cleanDomain(".."), "");
  assert.equal(cleanDomain("a/../../etc"), "a");
  assert.equal(cleanDomain(`x"><script>`), "");
  assert.equal(cleanBlogPath("../../etc"), "etc");
  assert.equal(cleanBlogPath(`/Blog/"><x>/`), "blog/x");
  assert.equal(cleanBlogPath(""), "blog");
  assert.equal(cleanColor("#ff00aa", "#000"), "#ff00aa");
  assert.equal(cleanColor("rgb(1, 2, 3)", "#000"), "rgb(1, 2, 3)");
  assert.equal(cleanColor("red;}</style><script>alert(1)</script>", "#000"), "#000");
  const site = normaliseSite({ domain: "Ex.com", color: "}</style>", blogPath: "../x", id: "a/b" });
  assert.deepEqual([site.domain, site.color.startsWith("#"), site.blogPath, site.id], ["ex.com", true, "x", "a-b"]);
});

test("API guard blocks foreign hosts, cross-site requests and CSRF", () => {
  const req = (method: string, h: Record<string, string>) => ({ method, headers: new Headers(h) });
  const local = { host: "127.0.0.1:3737" };
  assert.equal(checkRequest(req("GET", local)), null);
  assert.equal(checkRequest(req("GET", { host: "[::1]:3737" })), null);
  assert.equal(checkRequest(req("GET", { host: "evil.com" })), "Forbidden host");
  assert.equal(checkRequest(req("GET", { host: "localhost.evil.com:3737" })), "Forbidden host");
  assert.equal(checkRequest(req("GET", { ...local, "sec-fetch-site": "cross-site" })), "Cross-site request blocked");
  assert.equal(checkRequest(req("GET", { ...local, "sec-fetch-site": "same-site" })), "Cross-site request blocked");
  assert.equal(checkRequest(req("GET", { ...local, "sec-fetch-site": "same-origin" })), null);
  assert.equal(checkRequest(req("POST", { ...local, origin: "null", "x-agentic-os": "1" })), "Cross-origin request blocked");
  assert.equal(checkRequest(req("POST", { ...local, origin: "http://evil.com", "x-agentic-os": "1" })), "Cross-origin request blocked");
  assert.equal(checkRequest(req("POST", local)), "Missing x-agentic-os header");
  assert.equal(checkRequest(req("POST", { ...local, origin: "http://127.0.0.1:3737", "x-agentic-os": "1" })), null);
});

test("vault notes: Markdown only, and symlinks can't escape the vault", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "aos-vault-"));
  const vault = path.join(base, "vault");
  await fs.mkdir(vault);
  await fs.writeFile(path.join(base, "secret.md"), "outside");
  await fs.writeFile(path.join(vault, "ok.md"), "inside");
  await fs.writeFile(path.join(vault, "config.json"), "{}");
  await fs.symlink(path.join(base, "secret.md"), path.join(vault, "link.md"));
  await fs.symlink(base, path.join(vault, "outdir"));
  assert.equal(await readNote(vault, "ok.md"), "inside");
  await assert.rejects(readNote(vault, "config.json"), /Markdown/);
  await assert.rejects(readNote(vault, "link.md"), /escapes/);
  await assert.rejects(readNote(vault, "outdir/secret.md"), /escapes/);
  await assert.rejects(writeNote(vault, "outdir/new", "x"), /escapes/);
  await writeNote(vault, "Folder/New note", "hello");
  assert.equal(await readNote(vault, "Folder/New note.md"), "hello");
  await fs.rm(base, { recursive: true, force: true });
});
