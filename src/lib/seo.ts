import { promises as fs } from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import type { AgentId, SeoArticle, SeoPost, SeoSession, SeoSite, Settings, Transcript } from "./types";
import { dataPath, newId, readJson, updateJson } from "./store";
import { complete } from "./agents";
import { buildMemoryContext } from "./vault";
import { logActivity } from "./activity";

export const SESSIONS = "seo/sessions.json";
export const TRANSCRIPTS = "seo/transcripts.json";
const SKILL_FILE = dataPath("seo", "SKILL.md");
const MAX_TRANSCRIPT_CHARS = 24_000;

export const DEFAULT_ANGLES = [
  "Beginner's step-by-step guide",
  "Honest comparison and verdict",
  "Case study: real results, broken down",
  "Mistakes to avoid and pro tips",
  "FAQ-driven deep dive",
  "Quick-start checklist for busy people",
  "Advanced playbook for power users",
];

export const DEFAULT_SKILL = `---
name: seo-article-writer
description: Writes one unique, rankable blog article per site from a keyword + a first-hand transcript.
---

# SEO article writer

You write articles for my network of niche sites. Each article must be genuinely useful,
first-hand and **unique** — five sites, five different articles, never spun copies.

## Rules
- Lead with the answer in the first 2–3 sentences (AI-overview friendly), then expand.
- Use the keyword naturally in the title, H1, first paragraph, one H2 and the conclusion.
- Ground every claim in the transcript / case study. Never invent numbers, quotes or results.
- Write in first person from my experience when the source supports it. Short paragraphs.
- Structure: H1 → intro → 4–7 H2 sections (use H3s, lists, a table where it helps) → FAQ (3–5 Qs) → conclusion with a clear next step.
- 1,000–1,600 words. Plain, confident, no fluff, no "in today's fast-paced world".
- Follow the site's editorial angle so the article differs from its siblings in title, hook, structure and examples.
- No links to competitors. You may suggest internal links as plain text in the conclusion.

## Output
Reply with ONLY YAML front matter (title, description) followed by the Markdown body.
`;

export async function getSkill(): Promise<string> {
  return fs.readFile(SKILL_FILE, "utf8").catch(() => DEFAULT_SKILL);
}

export async function saveSkill(md: string | null): Promise<void> {
  if (md === null) {
    await fs.rm(SKILL_FILE, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(SKILL_FILE), { recursive: true });
  await fs.writeFile(SKILL_FILE, md);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function cleanTranscript(raw: string): string {
  return raw
    .replace(/^WEBVTT.*$/m, "")
    .replace(/^\d+\s*$/gm, "") // SRT cue numbers
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*-->\s*.*$/gm, "") // SRT/VTT timings
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*$/gm, "") // YouTube "0:08" lines
    .replace(/^\d+ (?:minutes?|seconds?)(?:, \d+ seconds?)?/gm, "") // YouTube spoken timestamps
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------- articles

export interface ParsedArticle {
  title: string;
  description: string;
  markdown: string;
}

export function parseArticle(raw: string, keyword: string): ParsedArticle {
  let text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenced) text = fenced[1].trim();
  // Drop any chatter before the front matter.
  const fmStart = text.search(/^---\s*$/m);
  if (fmStart > 0 && fmStart < 400) text = text.slice(fmStart);

  let title = "";
  let description = "";
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (fm) {
    const field = (k: string) => fm[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
    title = field("title");
    description = field("description");
    text = text.slice(fm[0].length).trim();
  }
  const h1 = text.match(/^#\s+(.+)$/m);
  if (!title) title = h1?.[1]?.trim() || keyword;
  if (!h1) text = `# ${title}\n\n${text}`;
  if (!description) {
    const para = text
      .split(/\n{2,}/)
      .find((p) => p.trim() && !p.trim().startsWith("#"))
      ?.replace(/[*_`>#[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    description = (para || title).slice(0, 158);
  }
  return { title, description, markdown: text };
}

export function wordCount(md: string): number {
  return (md.replace(/[#>*_`[\]()-]/g, " ").match(/\S+/g) || []).length;
}

function contentDir(domain: string) {
  return dataPath("seo", "content", domain);
}
const manifestFile = (domain: string) => `seo/manifests/${domain}.json`;

export async function listPosts(domain: string): Promise<SeoPost[]> {
  return readJson<SeoPost[]>(manifestFile(domain), []);
}

export async function readPostMarkdown(domain: string, slug: string): Promise<string | null> {
  return fs.readFile(path.join(contentDir(domain), `${slug}.md`), "utf8").catch(() => null);
}

async function savePost(site: SeoSite, post: SeoPost, markdown: string) {
  await fs.mkdir(contentDir(site.domain), { recursive: true });
  await fs.writeFile(path.join(contentDir(site.domain), `${post.slug}.md`), markdown);
  await updateJson<SeoPost[]>(manifestFile(site.domain), [], (list) => [post, ...list.filter((p) => p.slug !== post.slug)]);
}

export async function markDeployed(domain: string, slugs: string[], at: number) {
  await updateJson<SeoPost[]>(manifestFile(domain), [], (list) => list.map((p) => (slugs.includes(p.slug) ? { ...p, deployedAt: at } : p)));
}

export function postUrl(site: SeoSite, slug: string) {
  return `https://${site.domain}/${site.blogPath}/${slug}/`;
}

// ---------------------------------------------------------------- generation jobs

// Live character counts while an article streams; merged into session reads.
const g = globalThis as unknown as { __seoLive?: Map<string, number> };
const live = (g.__seoLive ??= new Map());

export function withLive(s: SeoSession): SeoSession {
  if (s.status !== "running") return s;
  return { ...s, articles: s.articles.map((a) => (a.status === "writing" ? { ...a, chars: live.get(`${s.id}:${a.siteId}`) ?? a.chars } : a)) };
}

async function patchSession(id: string, fn: (s: SeoSession) => SeoSession) {
  await updateJson<SeoSession[]>(SESSIONS, [], (list) => list.map((s) => (s.id === id ? fn(s) : s)));
}

export interface GenerateInput {
  keyword: string;
  slug?: string;
  transcriptId?: string;
  transcriptText?: string;
  siteIds?: string[];
  engine?: AgentId;
  useMemory?: boolean;
}

export async function startGeneration(input: GenerateInput, s: Settings): Promise<SeoSession> {
  const keyword = input.keyword.trim();
  const slug = slugify(input.slug || keyword);
  if (!keyword || !slug) throw new Error("keyword is required");
  const sites = s.seo.sites.filter((x) => x.enabled && x.domain && (!input.siteIds?.length || input.siteIds.includes(x.id)));
  if (!sites.length) throw new Error("Add at least one site in Settings → SEO sites first");

  let transcript = "";
  let transcriptLabel = "(none)";
  if (input.transcriptId) {
    const t = (await readJson<Transcript[]>(TRANSCRIPTS, [])).find((x) => x.id === input.transcriptId);
    if (!t) throw new Error("transcript not found");
    transcript = t.text;
    transcriptLabel = t.title;
  } else if (input.transcriptText?.trim()) {
    transcript = cleanTranscript(input.transcriptText);
    transcriptLabel = "(pasted)";
  }

  const session: SeoSession = {
    id: newId("seo_"),
    keyword,
    slug,
    transcriptLabel,
    engine: input.engine || s.seo.engine,
    startedAt: Date.now(),
    status: "running",
    articles: sites.map((x) => ({ siteId: x.id, domain: x.domain, color: x.color, status: "pending", chars: 0 })),
  };
  await updateJson<SeoSession[]>(SESSIONS, [], (list) => [session, ...list].slice(0, 200));
  void runGeneration(session, sites, transcript, input.useMemory ?? s.seo.useMemory, s);
  return session;
}

async function runGeneration(session: SeoSession, sites: SeoSite[], transcript: string, useMemory: boolean, s: Settings) {
  const skill = await getSkill();
  const mem = useMemory ? await buildMemoryContext(`${session.keyword} ${transcript.slice(0, 2000)}`, s) : { text: "" };
  const system = [skill, mem.text].filter(Boolean).join("\n\n");
  const written: { title: string; domain: string }[] = [];
  const source = transcript.length > MAX_TRANSCRIPT_CHARS ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[…truncated]" : transcript;

  for (const [i, site] of sites.entries()) {
    const key = `${session.id}:${site.id}`;
    live.set(key, 0);
    await patchSession(session.id, (x) => ({
      ...x,
      articles: x.articles.map((a) => (a.siteId === site.id ? { ...a, status: "writing" } : a)),
    }));
    const angle = site.angle || DEFAULT_ANGLES[i % DEFAULT_ANGLES.length];
    const prompt = [
      `Write article ${i + 1} of ${sites.length} targeting the keyword "${session.keyword}".`,
      `Site: ${site.name} (${site.domain})\nEditorial angle for this site: ${angle}`,
      source
        ? `Source material — my own transcript / case study. Base facts on this; don't invent stats:\n<transcript>\n${source}\n</transcript>`
        : "No transcript was provided: write from well-established knowledge and avoid specific made-up numbers.",
      written.length
        ? `Already written for sibling sites in this batch. Yours MUST use a different title, hook, structure and examples:\n${written.map((w) => `- "${w.title}" (${w.domain})`).join("\n")}`
        : "",
      `Output ONLY this format, no preamble or closing remarks:\n---\ntitle: <SEO title under 60 characters containing the keyword>\ndescription: <meta description, 140-160 characters>\n---\n# <H1>\n<article body in Markdown>`,
    ]
      .filter(Boolean)
      .join("\n\n");

    let article: SeoArticle;
    try {
      let chars = 0;
      const raw = await complete(session.engine, { prompt, system, timeoutMs: 20 * 60_000 }, s, (d) => {
        chars += d.length;
        live.set(key, chars);
      });
      if (raw.trim().length < 200) throw new Error(`reply too short (${raw.trim().length} chars): ${raw.slice(0, 160)}`);
      const parsed = parseArticle(raw, session.keyword);
      const words = wordCount(parsed.markdown);
      await savePost(
        site,
        {
          slug: session.slug,
          title: parsed.title,
          description: parsed.description,
          keyword: session.keyword,
          date: new Date().toISOString(),
          words,
          sessionId: session.id,
        },
        parsed.markdown,
      );
      written.push({ title: parsed.title, domain: site.domain });
      article = { siteId: site.id, domain: site.domain, color: site.color, status: "done", chars: raw.length, title: parsed.title, words, url: postUrl(site, session.slug) };
    } catch (e) {
      article = { siteId: site.id, domain: site.domain, color: site.color, status: "error", chars: live.get(key) ?? 0, error: (e as Error).message.slice(0, 500) };
    }
    live.delete(key);
    await patchSession(session.id, (x) => ({ ...x, articles: x.articles.map((a) => (a.siteId === site.id ? article : a)) }));
  }

  const ms = Date.now() - session.startedAt;
  let final: SeoSession | undefined;
  await patchSession(session.id, (x) => {
    const ok = x.articles.filter((a) => a.status === "done").length;
    final = { ...x, ms, status: ok === x.articles.length ? "done" : ok ? "partial" : "error" };
    return final;
  });
  const ok = final?.articles.filter((a) => a.status === "done").length ?? 0;
  await logActivity({
    kind: "seo.generate",
    agent: session.engine,
    title: `${session.keyword}: ${ok} of ${sites.length} articles written`,
    detail: `${Math.round(ms / 1000)}s`,
    ok: ok > 0,
    href: "/seo?tab=history",
  });
}

// ---------------------------------------------------------------- static site build

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(site: SeoSite, o: { title: string; description: string; canonical: string; body: string; jsonLd?: object }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary">
${o.jsonLd ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
<style>
:root{--accent:${site.color};--ink:#16141f;--muted:#5d5a6b;--line:#e9e7f0;--bg:#fff}
@media (prefers-color-scheme:dark){:root{--ink:#ecebf3;--muted:#a3a0b4;--line:#2a2838;--bg:#0f0e15}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
a{color:var(--accent)}header,main,footer{max-width:760px;margin:0 auto;padding:0 20px}
header{display:flex;justify-content:space-between;align-items:center;padding-top:22px;padding-bottom:22px;border-bottom:1px solid var(--line)}
header .brand{font-weight:700;color:var(--ink);text-decoration:none;letter-spacing:-.01em}header nav a{margin-left:18px;color:var(--muted);text-decoration:none;font-size:15px}
main{padding-top:36px;padding-bottom:60px}h1{font-size:clamp(30px,5vw,42px);line-height:1.15;letter-spacing:-.02em;margin:.2em 0 .5em}
h2{font-size:26px;line-height:1.25;margin:1.8em 0 .5em;letter-spacing:-.01em}h3{font-size:20px;margin:1.5em 0 .4em}
.meta{color:var(--muted);font-size:14px}blockquote{margin:1.4em 0;padding:.4em 1.1em;border-left:3px solid var(--accent);color:var(--muted)}
table{border-collapse:collapse;width:100%;margin:1.4em 0;font-size:15px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:8px 12px;text-align:left}
code{background:rgba(127,127,127,.12);padding:.1em .35em;border-radius:4px;font-size:.9em}img{max-width:100%;height:auto}
.related{margin-top:56px;padding-top:24px;border-top:1px solid var(--line)}.related ul,.posts{list-style:none;padding:0}
.related li,.posts li{margin:0 0 14px}.posts li a{font-size:20px;font-weight:600;text-decoration:none}.posts p{margin:.2em 0 0;color:var(--muted);font-size:15px}
footer{padding-top:24px;padding-bottom:40px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
</style>
</head>
<body>
<header><a class="brand" href="/">${esc(site.name)}</a><nav><a href="/">Home</a><a href="/${site.blogPath}/">Blog</a></nav></header>
<main>
${o.body}
</main>
<footer>© ${new Date().getFullYear()} ${esc(site.name)}</footer>
</body>
</html>
`;
}

/** URL schemes allowed in published links and images. Relative URLs and #anchors are always allowed. */
export function safeUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  // Browsers ignore control characters and whitespace inside a scheme ("java\tscript:"), so strip them first.
  // eslint-disable-next-line no-control-regex
  const probe = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase();
  const scheme = probe.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
  if (!scheme) return href.trim(); // relative, protocol-relative or #anchor
  return ["http", "https", "mailto"].includes(scheme) ? href.trim() : null;
}

/**
 * Model output is published to the open web, so it is rendered allow-list style:
 * raw HTML in the Markdown is escaped (shown as text, never parsed) and only http(s)/mailto/relative URLs survive.
 */
const articleMarked = new Marked({ gfm: true });
articleMarked.use({
  renderer: {
    html({ text }) {
      return esc(text);
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      if (!url) return inner;
      const external = /^(https?:)?\/\//i.test(url);
      return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ""}${external ? ' rel="noopener nofollow"' : ""}>${inner}</a>`;
    },
    image({ href, title, text }) {
      const url = safeUrl(href);
      if (!url || /^mailto:/i.test(url)) return esc(text);
      return `<img src="${esc(url)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ""} loading="lazy">`;
    },
  },
});

export function renderMarkdown(markdown: string): string {
  return stripActiveContent(articleMarked.parse(markdown, { async: false }) as string);
}

/** Defence in depth on top of renderMarkdown: drop anything active that still made it into the HTML. */
export function stripActiveContent(html: string): string {
  let out = html;
  // Repeat until stable so nested tricks like <scr<script>ipt> can't reassemble.
  for (let i = 0; i < 5; i++) {
    const next = out
      .replace(/<(script|iframe|frame|frameset|object|embed|style|base|meta|link|form|svg|math|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/?(script|iframe|frame|frameset|object|embed|style|base|meta|link|form|svg|math|template|noscript)\b[^>]*>/gi, "")
      .replace(/(?:\s+|(?<=[/"']))on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(?:javascript|vbscript|data):[^"'\s>]*\2/gi, '$1="#"');
    if (next === out) break;
    out = next;
  }
  return out;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export async function renderPost(site: SeoSite, post: SeoPost, posts: SeoPost[]): Promise<string | null> {
  const md = await readPostMarkdown(site.domain, post.slug);
  if (md === null) return null;
  const html = renderMarkdown(md);
  const related = posts.filter((p) => p.slug !== post.slug).slice(0, 5);
  const canonical = postUrl(site, post.slug);
  const body = `<p class="meta">${fmtDate(post.date)} · ${Math.max(1, Math.round(post.words / 230))} min read</p>
<article>
${html}
</article>
${related.length ? `<aside class="related"><h2>Related posts</h2><ul>${related.map((p) => `<li><a href="/${site.blogPath}/${p.slug}/">${esc(p.title)}</a></li>`).join("")}</ul></aside>` : ""}`;
  return page(site, {
    title: post.title,
    description: post.description,
    canonical,
    body,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: canonical,
      publisher: { "@type": "Organization", name: site.name },
    },
  });
}

function blogIndex(site: SeoSite, posts: SeoPost[]) {
  return page(site, {
    title: `Blog — ${site.name}`,
    description: `Articles and guides from ${site.name}.`,
    canonical: `https://${site.domain}/${site.blogPath}/`,
    body: `<h1>Blog</h1><ul class="posts">${posts
      .map((p) => `<li><a href="/${site.blogPath}/${p.slug}/">${esc(p.title)}</a><p>${esc(p.description)}</p></li>`)
      .join("")}</ul>`,
  });
}

function sitemap(site: SeoSite, posts: SeoPost[]) {
  const urls = [`https://${site.domain}/`, `https://${site.domain}/${site.blogPath}/`, ...posts.map((p) => postUrl(site, p.slug))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

export interface BuiltSite {
  /** Files Agentic OS owns and always overwrites (the blog). */
  owned: Map<string, Buffer>;
  /** Root files only written when the live site doesn't already have them. */
  optional: Map<string, Buffer>;
}

export async function buildSite(site: SeoSite): Promise<BuiltSite> {
  const posts = (await listPosts(site.domain)).sort((a, b) => b.date.localeCompare(a.date));
  const owned = new Map<string, Buffer>();
  for (const p of posts) {
    const html = await renderPost(site, p, posts);
    if (html) owned.set(`/${site.blogPath}/${p.slug}/index.html`, Buffer.from(html));
  }
  owned.set(`/${site.blogPath}/index.html`, Buffer.from(blogIndex(site, posts)));
  owned.set(`/${site.blogPath}/sitemap.xml`, Buffer.from(sitemap(site, posts)));

  const optional = new Map<string, Buffer>();
  optional.set(
    "/index.html",
    Buffer.from(
      page(site, {
        title: site.name,
        description: `${site.name} — guides and case studies.`,
        canonical: `https://${site.domain}/`,
        body: `<h1>${esc(site.name)}</h1><h2>Latest articles</h2><ul class="posts">${posts
          .slice(0, 12)
          .map((p) => `<li><a href="/${site.blogPath}/${p.slug}/">${esc(p.title)}</a><p>${esc(p.description)}</p></li>`)
          .join("")}</ul>`,
      }),
    ),
  );
  optional.set("/sitemap.xml", Buffer.from(sitemap(site, posts)));
  optional.set("/robots.txt", Buffer.from(`User-agent: *\nAllow: /\n\nSitemap: https://${site.domain}/sitemap.xml\nSitemap: https://${site.domain}/${site.blogPath}/sitemap.xml\n`));
  return { owned, optional };
}
