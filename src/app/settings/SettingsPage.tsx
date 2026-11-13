"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bot, Brain, Download, Mic, Plus, Save, Trash2, TrendingUp, User, Wand2 } from "lucide-react";
import type { SeoSite, Settings } from "@/lib/types";
import { api } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { useStatus } from "@/components/StatusProvider";
import { LivePill, SectionTitle, Spinner, useToast } from "@/components/ui";

type Draft = Settings;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}
function set<T>(obj: T, path: string, value: unknown): T {
  const copy = structuredClone(obj) as Record<string, unknown>;
  const keys = path.split(".");
  let o = copy;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
  return copy as T;
}

function Section({ id, icon, title, children, aside }: { id: string; icon: typeof User; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 20 }}>
      <SectionTitle icon={icon} title={title}>{aside}</SectionTitle>
      <div className="card stack" style={{ gap: 16 }}>{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const { status, refresh } = useStatus();
  const [d, setD] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [netlifySites, setNetlifySites] = useState<{ id: string; name: string; domain: string }[] | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then(setD);
  }, []);

  if (!d) return <Spinner />;

  const upd = (path: string, value: unknown) => {
    setD((x) => (x ? set(x, path, value) : x));
    setDirty(true);
  };
  const text = (path: string, label: string, hint?: string, opts: { secret?: boolean; mono?: boolean; placeholder?: string } = {}) => (
    <label className="field">
      {label}
      <input
        className={`input ${opts.mono !== false ? "mono" : ""}`}
        type={opts.secret ? "password" : "text"}
        value={String(get(d, path) ?? "")}
        placeholder={opts.placeholder}
        autoComplete="off"
        onChange={(e) => upd(path, e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
  const toggle = (path: string, label: string) => (
    <label className="check">
      <input type="checkbox" checked={Boolean(get(d, path))} onChange={(e) => upd(path, e.target.checked)} /> {label}
    </label>
  );
  const select = (path: string, label: string, options: [string, string][]) => (
    <label className="field">
      {label}
      <select className="select" value={String(get(d, path))} onChange={(e) => upd(path, e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
  const pill = (id: "claude" | "hermes" | "openclaw" | "api") => <LivePill online={status ? status.agents[id].online : null} />;

  const sites = d.seo.sites;
  const setSites = (next: SeoSite[]) => upd("seo.sites", next);
  const setSite = (i: number, patch: Partial<SeoSite>) => setSites(sites.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    setSaving(true);
    try {
      const next = await api<Settings>("/api/settings", {
        method: "PUT",
        json: { ...d, seo: { ...d!.seo, sites: d!.seo.sites.map((s) => ({ ...s, id: s.id || s.domain })) } },
      });
      setD(next);
      setDirty(false);
      refresh();
      toast("Settings saved");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Where your vault lives, how each agent is launched, your Netlify sites and Studio providers. Stored locally in data/settings.json.">
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? <Spinner /> : <Save size={15} />} Save changes
        </button>
      </PageHeader>

      <Section id="profile" icon={User} title="Profile">
        <div className="grid cols-2">{text("profile.name", "Your name", "Used in prompts and journal headers.", { mono: false })}</div>
      </Section>

      <Section id="memory" icon={Brain} title="Memory (Obsidian vault)">
        {text("vault.path", "Vault folder", "Absolute path to your Obsidian vault. Default is a starter vault inside ./data/vault.")}
        <div className="grid cols-2">
          {text("vault.maxContextChars", "Memory budget (characters per prompt)")}
          <label className="field">
            Pinned profile notes
            <input
              className="input mono"
              value={d.vault.profileNotes.join(", ")}
              onChange={(e) => upd("vault.profileNotes", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
            <span className="hint">Comma-separated vault paths. Pin/unpin from the Memory page too.</span>
          </label>
        </div>
        {toggle("vault.injectByDefault", "Use memory for background tasks (kanban runs) by default")}
      </Section>

      <Section id="omi" icon={Mic} title="OMI (daily memory import)">
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          Conversations captured by your OMI wearable become one note per day in your vault, so every agent remembers them.
          Create a developer key in the OMI app: Settings → Developer → Create key (starts with <code>omi_dev_</code>).
        </p>
        <div className="grid cols-2">
          {text("omi.apiKey", "OMI developer API key", undefined, { secret: true })}
          {text("omi.folder", "Vault folder", "Notes are written as <folder>/OMI YYYY-MM-DD.md.", { mono: false })}
          {text("omi.baseUrl", "API base URL", "Leave as https://api.omi.me unless you self-host OMI.")}
        </div>
        {toggle("omi.autoImport", "Import new conversations automatically (every 6 hours while Agentic OS runs)")}
        {toggle("omi.includeTranscript", "Include transcripts (longer notes, richer memory)")}
      </Section>

      <Section id="agents" icon={Bot} title="Agents">
        <div className="row between"><h3>Claude Code</h3>{pill("claude")}</div>
        {toggle("agents.claude.enabled", "Enabled")}
        <div className="grid cols-2">
          {text("agents.claude.bin", "Binary", "Usually just `claude` (must be on PATH) or an absolute path.")}
          {text("agents.claude.cwd", "Working directory", "Where Claude Code runs (its project, CLAUDE.md, MCP config). Empty = this app's folder.")}
          {text("agents.claude.model", "Model (optional)", "Passed as --model, e.g. opus or sonnet. Empty = your default.")}
          {select("agents.claude.permissionMode", "Permission mode", [
            ["default", "default — tools that need approval are denied"],
            ["acceptEdits", "acceptEdits — may edit files in its working dir"],
            ["bypassPermissions", "bypassPermissions — full autonomy (careful)"],
            ["plan", "plan — read-only planning"],
          ])}
        </div>
        {text("agents.claude.extraArgs", "Extra arguments", "Appended to every call, e.g. --allowedTools \"Bash(git:*) Read\" --max-turns 20")}

        <div className="row between" style={{ marginTop: 10 }}><h3>Hermes</h3>{pill("hermes")}</div>
        {toggle("agents.hermes.enabled", "Enabled")}
        <div className="grid cols-2">
          {select("agents.hermes.mode", "Connection", [["cli", "CLI (one-shot command)"], ["http", "HTTP (OpenAI-compatible API server)"]])}
          {text("agents.hermes.home", "Hermes home", "Read for model, skills and sessions.")}
        </div>
        {d.agents.hermes.mode === "cli" ? (
          <div className="grid cols-2">
            {text("agents.hermes.bin", "Binary")}
            {text("agents.hermes.chatArgs", "Chat arguments", "{prompt} is replaced with your message. Remove it to send the prompt on stdin instead.")}
            {text("agents.hermes.versionArgs", "Version arguments", "Used for the health check.")}
          </div>
        ) : (
          <div className="grid cols-2">
            {text("agents.hermes.baseUrl", "Base URL", "e.g. http://127.0.0.1:8642/v1")}
            {text("agents.hermes.model", "Model name")}
            {text("agents.hermes.apiKey", "API key", undefined, { secret: true })}
          </div>
        )}

        <div className="row between" style={{ marginTop: 10 }}><h3>OpenClaw</h3>{pill("openclaw")}</div>
        {toggle("agents.openclaw.enabled", "Enabled")}
        <div className="grid cols-2">
          {select("agents.openclaw.mode", "Connection", [["cli", "CLI (openclaw agent …)"], ["http", "HTTP (gateway /v1/chat/completions)"]])}
          {text("agents.openclaw.gatewayUrl", "Gateway URL", "Health check target; also the HTTP base in HTTP mode.")}
          {text("agents.openclaw.agentId", "Agent id")}
          {text("agents.openclaw.home", "OpenClaw home", "Read for agent and session counts.")}
        </div>
        {d.agents.openclaw.mode === "cli" ? (
          <div className="grid cols-2">
            {text("agents.openclaw.bin", "Binary")}
            {text("agents.openclaw.chatArgs", "Chat arguments", "{prompt} and {agent} are substituted.")}
          </div>
        ) : (
          <div className="grid cols-2">{text("agents.openclaw.token", "Gateway token", undefined, { secret: true })}</div>
        )}

        <div className="row between" style={{ marginTop: 10 }}><h3>API fallback</h3>{pill("api")}</div>
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Any OpenAI-compatible endpoint — OpenRouter (free models), DeepSeek, xAI… Used as an engine for SEO, goals and journal.</p>
        {toggle("agents.api.enabled", "Enabled")}
        <div className="grid cols-2">
          {text("agents.api.baseUrl", "Base URL")}
          {text("agents.api.model", "Model")}
          {text("agents.api.apiKey", "API key", undefined, { secret: true })}
        </div>
      </Section>

      <Section
        id="seo"
        icon={TrendingUp}
        title="SEO & Netlify"
        aside={
          <button
            className="btn sm"
            onClick={async () => {
              try {
                setNetlifySites(await api("/api/seo/netlify-sites"));
              } catch (e) {
                toast(`${(e as Error).message}${dirty ? " — save your token first" : ""}`, true);
              }
            }}
          >
            <Download size={13} /> Load my Netlify sites
          </button>
        }
      >
        <div className="grid cols-2">
          {text("seo.netlifyToken", "Netlify personal access token", "Netlify → User settings → Applications → New access token.", { secret: true })}
          {select("seo.engine", "Default writing engine", [["claude", "Claude"], ["hermes", "Hermes"], ["openclaw", "OpenClaw"], ["api", "API"]])}
        </div>
        <label className="field">
          Search Console service-account key (JSON)
          <textarea
            className="textarea mono"
            rows={3}
            spellCheck={false}
            value={d.seo.gscServiceAccount}
            placeholder='{"type": "service_account", "client_email": "…", "private_key": "…"}'
            onChange={(e) => upd("seo.gscServiceAccount", e.target.value)}
          />
          <span className="hint">
            Optional: powers the clicks charts on SEO → History. Google Cloud → IAM → Service accounts → Keys → Add key (JSON). Then add the
            account&apos;s email as a user on each Search Console property. Stored locally and masked here.
          </span>
        </label>
        {toggle("seo.preserveExisting", "Preserve existing site files on deploy (recommended — only /blog/ is updated)")}
        {toggle("seo.useMemory", "Personalise articles with memory by default")}

        <div className="eyebrow" style={{ marginTop: 6 }}>Sites · {sites.length}</div>
        {sites.map((s, i) => (
          <div key={i} className="card tight" style={{ ["--c" as string]: s.color }}>
            <div className="row wrap" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "0 0 60px" }}>
                Color
                <input type="color" value={s.color} onChange={(e) => setSite(i, { color: e.target.value })} style={{ width: 48, height: 40, background: "none", border: 0 }} />
              </label>
              <label className="field" style={{ flex: "2 1 220px" }}>
                Domain
                <input className="input mono" value={s.domain} placeholder="example.com" onChange={(e) => setSite(i, { domain: e.target.value })} />
              </label>
              <label className="field" style={{ flex: "2 1 200px" }}>
                Site name
                <input className="input" value={s.name} placeholder="Shown in the site header" onChange={(e) => setSite(i, { name: e.target.value })} />
              </label>
              <label className="field" style={{ flex: "2 1 220px" }}>
                Netlify site id
                {netlifySites ? (
                  <select className="select" value={s.netlifySiteId} onChange={(e) => {
                    const ns = netlifySites.find((n) => n.id === e.target.value);
                    setSite(i, { netlifySiteId: e.target.value, ...(ns && !s.domain ? { domain: ns.domain, name: s.name || ns.name } : {}) });
                  }}>
                    <option value="">—</option>
                    {netlifySites.map((n) => <option key={n.id} value={n.id}>{n.domain}</option>)}
                  </select>
                ) : (
                  <input className="input mono" value={s.netlifySiteId} placeholder="API id or mysite.netlify.app" onChange={(e) => setSite(i, { netlifySiteId: e.target.value })} />
                )}
              </label>
            </div>
            <div className="row wrap" style={{ marginTop: 10, alignItems: "flex-end" }}>
              <label className="field" style={{ flex: "4 1 320px" }}>
                Editorial angle
                <input className="input" value={s.angle} placeholder="e.g. beginner tutorials · honest comparisons · case studies" onChange={(e) => setSite(i, { angle: e.target.value })} />
              </label>
              <label className="field" style={{ flex: "2 1 200px" }}>
                Search Console property
                <input className="input mono" value={s.gscProperty || ""} placeholder={s.domain ? `sc-domain:${s.domain}` : "sc-domain:example.com"} onChange={(e) => setSite(i, { gscProperty: e.target.value })} />
              </label>
              <label className="field" style={{ flex: "1 1 100px" }}>
                Blog path
                <input className="input mono" value={s.blogPath} onChange={(e) => setSite(i, { blogPath: e.target.value })} />
              </label>
              <label className="check" style={{ paddingBottom: 12 }}>
                <input type="checkbox" checked={s.enabled} onChange={(e) => setSite(i, { enabled: e.target.checked })} /> Enabled
              </label>
              <button className="btn icon ghost danger" aria-label="Remove site" onClick={() => setSites(sites.filter((_, j) => j !== i))} style={{ marginBottom: 2 }}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        <button
          className="btn"
          style={{ alignSelf: "flex-start" }}
          onClick={() =>
            setSites([
              ...sites,
              { id: "", name: "", domain: "", netlifySiteId: "", color: ["#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635"][sites.length % 5], angle: "", blogPath: "blog", enabled: true, gscProperty: "" },
            ])
          }
        >
          <Plus size={15} /> Add site
        </button>
      </Section>

      <Section id="studio" icon={Wand2} title="Studio">
        <div className="grid cols-3">
          {select("studio.imageProvider", "Images via", [["hermes", "Hermes"], ["claude", "Claude"], ["openclaw", "OpenClaw"], ["api", "Images API"]])}
          {select("studio.videoProvider", "Videos via", [["hermes", "Hermes"], ["claude", "Claude"], ["openclaw", "OpenClaw"]])}
          {select("studio.speechProvider", "Speech via", [["hermes", "Hermes"], ["claude", "Claude"], ["openclaw", "OpenClaw"], ["api", "Speech API"]])}
        </div>
        <div className="grid cols-2">
          {text("studio.outputDir", "Output folder", "Agents are asked to save files here.")}
          <label className="field">
            Extra media folders
            <input className="input mono" value={d.studio.mediaRoots.join(", ")} onChange={(e) => upd("studio.mediaRoots", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
            <span className="hint">The app only previews media from these folders, the output folder, the vault and ./data.</span>
          </label>
        </div>
        <div className="grid cols-3">
          {text("studio.apiBaseUrl", "Images/Speech API base URL")}
          {text("studio.imageModel", "Image model")}
          {text("studio.apiKey", "API key", undefined, { secret: true })}
          {text("studio.ttsModel", "TTS model")}
          {text("studio.ttsVoice", "TTS voice")}
        </div>
      </Section>

      <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
        {dirty && (
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <Save size={15} />} Save changes
          </button>
        )}
      </div>
    </>
  );
}
