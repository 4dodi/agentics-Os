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
      gscServiceAccount: process.env.GSC_SERVICE_ACCOUNT_JSON || "",
    },
    omi: {
      apiKey: process.env.OMI_API_KEY || "",
      baseUrl: process.env.OMI_API_URL || "https://api.omi.me",
      folder: "OMI",
      autoImport: false,
      includeTranscript: false,
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
  "seo.gscServiceAccount",
  "studio.apiKey",
  "omi.apiKey",
];

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T));
  const out: Obj = { ...(base as Obj) };
  for (const [k, v] of Object.entries(over)) {
    if (UNSAFE_KEYS.has(k)) continue;
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
  s.seo.sites = (Array.isArray(s.seo.sites) ? s.seo.sites : []).map(normaliseSite);
  s.vault.maxContextChars = Number(s.vault.maxContextChars) || 6000;
  s.omi.folder = cleanVaultFolder(s.omi.folder, "OMI");
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

/** Hostname characters only, so a domain can't break out of the data folder or the generated HTML. */
export function cleanDomain(raw: unknown): string {
  const d = String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*$/.test(d) ? d : "";
}

/** URL path segments made of safe characters only; no "." / ".." segments. */
export function cleanBlogPath(raw: unknown): string {
  const segs = String(raw ?? "blog")
    .split("/")
    .map((x) => x.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean);
  return segs.join("/") || "blog";
}

/** A vault-relative folder: plain names only, no "." / ".." segments or leading slash. */
export function cleanVaultFolder(raw: unknown, fallback: string): string {
  const segs = String(raw ?? "")
    .split(/[\\/]/)
    .map((x) => x.replace(/[^\p{L}\p{N} _-]+/gu, "").trim())
    .filter(Boolean);
  return segs.join("/") || fallback;
}

/** A CSS colour that can't escape the inline <style> block it's written into. */
export function cleanColor(raw: unknown, fallback: string): string {
  const c = String(raw || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  if (/^(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]+\)$/i.test(c)) return c;
  if (/^[a-z]{3,30}$/i.test(c)) return c;
  return fallback;
}

export function normaliseSite(site: Partial<SeoSite>, i = 0): SeoSite {
  const domain = cleanDomain(site.domain);
  return {
    id: String(site.id || domain || `site-${i}`).replace(/[^\w.-]/g, "-"),
    name: String(site.name || domain).slice(0, 120),
    domain,
    netlifySiteId: String(site.netlifySiteId || "").trim(),
    color: cleanColor(site.color, SITE_COLORS[i % SITE_COLORS.length]),
    angle: String(site.angle || ""),
    blogPath: cleanBlogPath(site.blogPath),
    enabled: site.enabled !== false,
    gscProperty: String(site.gscProperty || "").trim().slice(0, 300),
  };
}

export function vaultPath(s: Settings): string {
  return path.resolve(expandHome(s.vault.path));
}
