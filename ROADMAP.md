# Agentic OS — Plan & Roadmap

A local-first "operating system" for your AI agents: one dashboard on `localhost:3737`
that talks to **Claude Code**, **Hermes** (Nous Research) and **OpenClaw**, runs an
**SEO content pipeline** that deploys to Netlify, generates media in a **Studio**, and
gives every agent a shared **memory** (your Obsidian vault) so they know who you are.

Built from the reference video + screenshots (agentos.guide is not reachable from the
build environment, so the spec below is reconstructed from those).

---

## 1. Product scope (what each screen does)

| Screen | Purpose | Key features |
|---|---|---|
| **Mission Control** | Status of every agent, memory and signal | Live cards: Claude / OpenClaw / Hermes status, Heartbeat (poll ticks every 4s), combined p50 latency. Agent cards → open control room. Recent activity, goals snapshot, memory stats |
| **Claude** | Direct streaming line to Claude Code | Chat (token streaming via `claude -p --output-format stream-json`), session resume, Control Room (run `claude` subcommands, e.g. `mcp list`) |
| **OpenClaw** | Local agent gateway | One-shot chat (HTTP gateway or CLI), agents + sessions counts, Control Room |
| **Hermes** | Nous Research agent | Chat, model/provider readout (e.g. `grok-4.3 · xAI`), skills list, sessions, Control Room |
| **Goals** | What you're working toward | Goals with progress, milestones, "ask an agent to plan this", *one automation per week* tracker |
| **SEO** | Keyword + transcript → 5 unique articles → Netlify | Tabs: Generate · Deploy · History · Transcripts · Skill. Streams progress, one angle per site, deploys preserve existing site files |
| **Studio** | Images, videos, speech via agents/APIs | Voice-in prompt, inline preview, duration, Save / Save to vault |
| **Journal** | Daily log | Entries written to the vault (`Journal/YYYY-MM-DD.md`) + automatic activity timeline |
| **Memory** | Obsidian vault as agent memory | Browse/search/edit notes, wikilinks + backlinks, pin "profile" notes that are injected into every agent prompt |
| **Build Guide** | Setup docs inside the app | Install commands, config, first-day workflow |
| **Settings** | Configure everything | Vault path, agent command templates/URLs, Netlify token + sites, Studio providers, API fallback |

Global: sidebar with page-tinted active state, `LOCAL · <CITY>` + live clock, **⌘K command
palette**, `ALL SYSTEMS` health indicator, mic input (Web Speech API), agent-to-agent hand-off.

### The "secret" from the video: memory-first agents
Every chat / SEO / Studio request can be enriched with **context from your vault**:
pinned profile notes (who you are, what you do) + the top-matching notes for the request.
That's what makes outputs personalised and "gets better the more you use it".

---

## 2. Architecture

```
Browser (Next.js React UI) ──► Next.js route handlers (/api/*)  ── localhost:3737 only
                                   │
          ┌────────────────────────┼─────────────────────────────┐
          ▼                        ▼                             ▼
   Agent adapters            Local stores                 External services
   • claude  (CLI spawn,     • data/*.json (goals, chats,  • Netlify API (digest deploy)
     stream-json)              seo history, studio)        • OpenAI-compatible API
   • hermes  (CLI or HTTP)   • data/seo/sites/<domain>/      (OpenRouter / DeepSeek / xAI)
   • openclaw(CLI or HTTP)     static site per domain        for fallback text, images, TTS
   • api     (OpenAI-compat) • Obsidian vault (markdown)
```

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript, hand-written CSS design
  system (dark aurora glass), `lucide-react` icons, `react-markdown`. No database —
  JSON files in `data/` and markdown in the vault, so it's easy for agents to read too.
- **Adapters** share one interface: `status()`, `chat(prompt, {sessionId}) → stream`,
  `run(args)`. Every command/URL is configurable in Settings because CLI flags change
  between agent versions.
- **Streaming:** route handlers return NDJSON streams (`{type:"delta"|"done"|"error"|"progress"}`).
- **Safety:** server binds to `127.0.0.1`; media endpoint only serves media extensions
  from allow-listed roots; secrets are masked in API responses; Control Room spawns the
  agent binary directly (no shell).
- **Netlify deploy:** file-digest API. Before deploying, the current published deploy's
  file list is merged in (by SHA) so existing pages aren't wiped. Blog index + sitemap
  regenerated each deploy.

---

## 3. Roadmap

### Phase 0 — Foundation ✅
- [x] Next.js scaffold on port 3737, design tokens, fonts, aurora background
- [x] App shell: sidebar, page header (clock, ⌘K, ALL SYSTEMS), tabs, cards, pills
- [x] JSON store, settings (env + `data/settings.json`), activity log

### Phase 1 — Agents ✅
- [x] Adapter layer: Claude (stream-json), Hermes, OpenClaw (CLI + HTTP modes), API fallback
- [x] `/api/status` probes (version, latency, model, agents/sessions)
- [x] Mission Control with 4s heartbeat polling
- [x] Reusable Chat panel: streaming, markdown, ⌘+Enter, mic, clear, history, media-path previews, hand-off
- [x] Control Room console per agent

### Phase 2 — Memory & self ✅
- [x] Vault service: tree, search, read/write, wikilinks/backlinks, pinned profile notes
- [x] Memory page; context injection toggle in every chat
- [x] Journal (vault-backed) + activity timeline
- [x] Goals with milestones + "plan with agent"

### Phase 3 — SEO pipeline ✅
- [x] Sites config, Transcripts CRUD, editable Skill prompt
- [x] Generate: 5 articles × unique angle, streamed progress, static HTML per site
- [x] Netlify deploy (digest + preserve existing), History (deploys + sessions)

### Phase 4 — Studio ✅
- [x] Images / Videos / Speech via agent (Hermes default) or OpenAI-compatible API
- [x] Media serving, inline preview, save/download, save to vault

### Phase 5 — Polish & ship ✅
- [x] ⌘K command palette, Build Guide, Settings UI
- [x] Mock agent CLIs for demo/testing, typecheck + build, browser QA screenshots
- [x] README with install + configuration

Status: v0.1 built and verified. Claude Code tested live; Hermes and OpenClaw tested through the mock CLIs;
Netlify deploys tested against a mock API, including the check that existing site files are preserved;
30 unit tests; production build passes.

**Not verified yet:** real Hermes/OpenClaw CLI flags (they're editable templates), a real Netlify account,
and real image/video generation tools.

### Phase 6 — Security hardening ✅
- [x] Allow-list Markdown renderer for published articles (raw HTML escaped, URL schemes allow-listed)
- [x] Cross-site request blocking via `Sec-Fetch-Site`, strict `Origin` handling, CSP and anti-framing headers
- [x] No remote image/media auto-loading in the UI (closes prompt-injection exfiltration through image URLs)
- [x] Media and vault access checked after `realpath`; vault limited to `.md`; data files written `0600`
- [x] Validation of SEO site fields, goal and kanban updates; prototype-safe settings merge
- [x] Dependencies updated (Next 16.4.6, marked 18.2, lucide-react 1.72, geist 1.9); `npm audit` clean

### Phase 7 — v2 features ✅
- [x] Scheduled automations runner: hourly/daily/weekly per automation goal, Run now, run history, results to the journal
- [x] OMI daily memory import → `OMI/OMI YYYY-MM-DD.md` notes (API or export file, auto-import every 6 hours, no duplicates)
- [x] Google Search Console clicks per site on SEO → History (service account, 7/28/90 days, chart + table)
- [x] Multi-agent Boardroom: parallel answers streamed side by side, a chair writes the recommendation, saved meetings
- [x] Kanban for Hermes tasks (already shipped in v0.1, in each Control Room)

### Later (v3 ideas)
- Hyperframes / Remotion skill launchers in Studio (video editing by file path)
- Search Console queries and pages per article; automations that react to ranking changes
- Boardroom follow-up rounds (members respond to each other)
