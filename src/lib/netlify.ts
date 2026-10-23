import crypto from "node:crypto";
import type { SeoSite } from "./types";
import { buildSite } from "./seo";

// Overridable so the deploy flow can be exercised against a local mock.
const API = process.env.NETLIFY_API_URL || "https://api.netlify.com/api/v1";

export function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "user-agent": "agentic-os", ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Netlify ${init.method || "GET"} ${path} → ${res.status} ${text.slice(0, 300)}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url: string;
  custom_domain: string | null;
  published_deploy?: { id: string } | null;
}

interface NetlifyDeploy {
  id: string;
  state: string;
  required?: string[];
  error_message?: string;
  deploy_ssl_url?: string;
}

export async function listNetlifySites(token: string): Promise<{ id: string; name: string; domain: string }[]> {
  const sites = await call<NetlifySite[]>(token, "/sites?filter=all&per_page=100");
  return sites.map((s) => ({ id: s.id, name: s.name, domain: s.custom_domain || new URL(s.ssl_url || s.url).host }));
}

/** Files of the currently published deploy, as { "/path": sha1 }. */
async function publishedFiles(token: string, deployId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let page = 1; page < 50; page++) {
    const files = await call<{ id: string; sha: string }[]>(token, `/deploys/${deployId}/files?page=${page}&per_page=1000`);
    for (const f of files) out[f.id] = f.sha;
    if (files.length < 1000) break;
  }
  return out;
}

export interface DeployResult {
  deployId: string;
  files: number;
  uploaded: number;
  url: string;
}

/**
 * File-digest deploy. With preserveExisting, the live deploy's files are carried over by SHA
 * (Netlify doesn't re-upload them), so publishing the blog never wipes the rest of the site.
 */
export async function deploySite(site: SeoSite, token: string, preserveExisting: boolean): Promise<DeployResult> {
  if (!token) throw new Error("Add a Netlify personal access token in Settings → SEO");
  if (!site.netlifySiteId) throw new Error(`No Netlify site id for ${site.domain} (Settings → SEO sites)`);
  const info = await call<NetlifySite>(token, `/sites/${encodeURIComponent(site.netlifySiteId)}`);

  const existing = preserveExisting && info.published_deploy?.id ? await publishedFiles(token, info.published_deploy.id) : {};
  const built = await buildSite(site);
  const ours = new Map<string, Buffer>(built.owned);
  for (const [p, buf] of built.optional) if (!(p in existing)) ours.set(p, buf);

  const digest: Record<string, string> = { ...existing };
  const bySha = new Map<string, string>();
  for (const [p, buf] of ours) {
    const h = sha1(buf);
    digest[p] = h;
    bySha.set(h, p);
  }

  const deploy = await call<NetlifyDeploy>(token, `/sites/${info.id}/deploys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: digest }),
  });

  let uploaded = 0;
  for (const h of deploy.required ?? []) {
    const p = bySha.get(h);
    if (!p) continue; // carried-over file Netlify already has
    const encoded = p.split("/").map(encodeURIComponent).join("/");
    await call(token, `/deploys/${deploy.id}/files${encoded}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(ours.get(p)!),
    });
    uploaded++;
  }

  const deadline = Date.now() + 120_000;
  let state = deploy.state;
  while (!["ready", "error", "rejected"].includes(state) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const d = await call<NetlifyDeploy>(token, `/deploys/${deploy.id}`);
    state = d.state;
    if (state === "error" || state === "rejected") throw new Error(`Netlify deploy ${state}: ${d.error_message || "unknown error"}`);
  }
  if (state !== "ready") throw new Error(`Netlify deploy still "${state}" after 2 minutes — check the Netlify dashboard`);

  return { deployId: deploy.id, files: Object.keys(digest).length, uploaded, url: `https://${site.domain}` };
}
