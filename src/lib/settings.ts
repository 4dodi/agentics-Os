import path from "node:path";
import { DATA_DIR, expandHome, readJson, updateJson } from "./store";
import type { Settings, SeoSite } from "./types";

const FILE = "settings.json";

export function defaultSettings(): Settings {
  return {
    profile: { name: "", city: "" },
    vault: {
      path: process.env.OBSIDIAN_VAULT || path.join(DATA_DIR, "vault"),
      profileNotes: ["About Me.md"],
      injectByDefault: true,
      maxContextChars: 6000,
    },
    agents: {
      claude: {
        enabled: true,
        bin: process.env.CLAUDE_BIN || "claude",
        cwd: "",
        model: "",
        permissionMode: "default",
        extraArgs: "",
      },
      hermes: {
        enabled: true,
        mode: "cli",
        bin: process.env.HERMES_BIN || "hermes",
        chatArgs: "chat -q {prompt}",
        versionArgs: "--version",
        home: "~/.hermes",
        baseUrl: "http://127.0.0.1:8642/v1",
        apiKey: "",
        model: "hermes-agent",
      },
      openclaw: {
        enabled: true,
        mode: "cli",
        bin: process.env.OPENCLAW_BIN || "openclaw",
        chatArgs: "agent --agent {agent} --message {prompt}",
        versionArgs: "--version",
        home: "~/.openclaw",
        gatewayUrl: "http://127.0.0.1:18789",
        token: "",
        agentId: "main",
      },
      api: {
        enabled: Boolean(process.env.OPENAI_COMPAT_API_KEY),
        baseUrl: process.env.OPENAI_COMPAT_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENAI_COMPAT_API_KEY || "",
        model: process.env.OPENAI_COMPAT_MODEL || "openrouter/auto",
      },
    },
    seo: {
      engine: "claude",
      netlifyToken: process.env.NETLIFY_AUTH_TOKEN || "",
      preserveExisting: true,
      useMemory: true,
      sites: [],
    },
    studio: {
      imageProvider: "hermes",
      videoProvider: "hermes",
      speechProvider: "hermes",
      outputDir: path.join(DATA_DIR, "studio"),
      mediaRoots: ["~/Downloads", "~/.hermes", "~/Movies", "~/Pictures"],
      apiBaseUrl: "https://api.openai.com/v1",
      apiKey: "",
      imageModel: "gpt-image-1",
      ttsModel: "gpt-4o-mini-tts",
      ttsVoice: "alloy",
    },
  };
}

/** Dotted paths of secret fields. They are masked on read and kept when the mask is sent back. */
const SECRET_PATHS = [
  "agents.hermes.apiKey",
  "agents.openclaw.token",
  "agents.api.apiKey",
  "seo.netlifyToken",
  "studio.apiKey",
];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T));
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out && isObj(out[k]) && isObj(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), obj);
}

function setPath(obj: Obj, dotted: string, value: unknown) {
  const keys = dotted.split(".");
  let o: Obj = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k] as Obj;
  }
  o[keys[keys.length - 1]] = value;
}

export const MASK_PREFIX = "••••";

function mask(v: string): string {
  return v ? MASK_PREFIX + v.slice(-4) : "";
}

export async function getSettings(): Promise<Settings> {
  const stored = await readJson<Obj>(FILE, {});
  const s = deepMerge(defaultSettings(), stored);
  s.seo.sites = (s.seo.sites || []).map(normaliseSite);
  s.vault.maxContextChars = Number(s.vault.maxContextChars) || 6000;
  return s;
}

/** Settings safe to send to the browser. */
export async function getPublicSettings(): Promise<Settings> {
  const s = structuredClone(await getSettings()) as unknown as Obj;
  for (const p of SECRET_PATHS) setPath(s, p, mask(String(getPath(s, p) ?? "")));
  return s as unknown as Settings;
}

export async function saveSettings(patch: Obj): Promise<Settings> {
  const current = await getSettings();
  // A masked secret coming back from the UI means "unchanged".
  for (const p of SECRET_PATHS) {
    const v = getPath(patch, p);
    if (typeof v === "string" && v.startsWith(MASK_PREFIX)) setPath(patch, p, getPath(current, p));
  }
  await updateJson<Obj>(FILE, {}, (stored) => {
    const merged = deepMerge(stored, patch) as Obj;
    // Arrays are replaced, not merged, so removing a site actually removes it.
    if (isObj(patch.seo) && Array.isArray(patch.seo.sites)) setPath(merged, "seo.sites", patch.seo.sites);
    if (isObj(patch.vault) && Array.isArray(patch.vault.profileNotes))
      setPath(merged, "vault.profileNotes", patch.vault.profileNotes);
    if (isObj(patch.studio) && Array.isArray(patch.studio.mediaRoots))
      setPath(merged, "studio.mediaRoots", patch.studio.mediaRoots);
    return merged;
  });
  return getSettings();
}

const SITE_COLORS = ["#fb7185", "#c084fc", "#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#60a5fa"];

export function normaliseSite(site: Partial<SeoSite>, i = 0): SeoSite {
  const domain = String(site.domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  return {
    id: site.id || domain || `site-${i}`,
    name: site.name || domain,
    domain,
    netlifySiteId: site.netlifySiteId || "",
    color: site.color || SITE_COLORS[i % SITE_COLORS.length],
    angle: site.angle || "",
    blogPath: (site.blogPath || "blog").replace(/^\/+|\/+$/g, ""),
    enabled: site.enabled !== false,
  };
}

export function vaultPath(s: Settings): string {
  return path.resolve(expandHome(s.vault.path));
}
