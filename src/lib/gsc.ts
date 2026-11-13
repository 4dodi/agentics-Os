import crypto from "node:crypto";
import type { GscDay, GscSiteReport, SeoSite, Settings } from "./types";

/**
 * Google Search Console via a service account (no OAuth browser dance):
 * sign a JWT with the account's private key → exchange it for an access token →
 * POST searchAnalytics/query grouped by date. Add the service account's email as a
 * user (Restricted is enough) on each Search Console property.
 */

const TOKEN_URL = process.env.GSC_TOKEN_URL || "https://oauth2.googleapis.com/token";
const API = process.env.GSC_API_URL || "https://searchconsole.googleapis.com/webmasters/v3";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const CACHE_MS = 15 * 60_000;

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(raw: string): ServiceAccount {
  let j: Partial<ServiceAccount> & { type?: string };
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("The Search Console key isn't valid JSON — paste the whole service-account key file");
  }
  if (!j.client_email || !j.private_key) throw new Error("The Search Console key needs client_email and private_key");
  return { client_email: j.client_email, private_key: j.private_key };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signJwt(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key);
  return `${header}.${claims}.${b64url(sig)}`;
}

const g = globalThis as unknown as {
  __gscToken?: { email: string; token: string; exp: number };
  __gscCache?: Map<string, { at: number; report: GscSiteReport }>;
};
const cache = (g.__gscCache ??= new Map());

async function accessToken(sa: ServiceAccount): Promise<string> {
  const t = g.__gscToken;
  if (t && t.email === sa.client_email && t.exp > Date.now() + 60_000) return t.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt(sa) }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description || j.error || res.status}`);
  g.__gscToken = { email: sa.client_email, token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return j.access_token;
}

export function propertyFor(site: SeoSite): string {
  return site.gscProperty || `sc-domain:${site.domain}`;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Every date in [start, end] with zero-filled gaps, so the chart's x-axis is continuous. */
export function fillDays(rows: { keys?: string[]; clicks?: number; impressions?: number }[], start: string, end: string): GscDay[] {
  const by = new Map(rows.map((r) => [r.keys?.[0] ?? "", r]));
  const out: GscDay[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); isoDay(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const r = by.get(isoDay(d));
    out.push({ date: isoDay(d), clicks: Math.round(r?.clicks ?? 0), impressions: Math.round(r?.impressions ?? 0) });
  }
  return out;
}

async function querySite(token: string, site: SeoSite, days: number): Promise<GscSiteReport> {
  // Search Console data lags ~2 days; end there so the last points aren't falsely low.
  const end = new Date(Date.now() - 2 * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const property = propertyFor(site);
  const base = { siteId: site.id, domain: site.domain, color: site.color, property };
  const res = await fetch(`${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ startDate: isoDay(start), endDate: isoDay(end), dimensions: ["date"], rowLimit: 1000, dataState: "final" }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.error?.message || `HTTP ${res.status}`;
    const hint = res.status === 403 ? " — add the service account email as a user on this property" : "";
    return { ...base, ok: false, error: `${msg}${hint}`.slice(0, 300), days: [], clicks: 0, impressions: 0 };
  }
  const list = fillDays(j.rows ?? [], isoDay(start), isoDay(end));
  return {
    ...base,
    ok: true,
    days: list,
    clicks: list.reduce((a, d) => a + d.clicks, 0),
    impressions: list.reduce((a, d) => a + d.impressions, 0),
  };
}

/** Daily clicks and impressions for every enabled site (cached for 15 minutes). */
export async function searchConsoleReport(s: Settings, days = 28, fresh = false): Promise<GscSiteReport[]> {
  if (!s.seo.gscServiceAccount) throw new Error("Add a Search Console service-account key in Settings → SEO");
  const sa = parseServiceAccount(s.seo.gscServiceAccount);
  const sites = s.seo.sites.filter((x) => x.enabled && x.domain);
  if (!sites.length) return [];
  const token = await accessToken(sa);
  return Promise.all(
    sites.map(async (site) => {
      const key = `${sa.client_email}|${propertyFor(site)}|${days}`;
      const hit = cache.get(key);
      if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return { ...hit.report, siteId: site.id, color: site.color };
      const report = await querySite(token, site, days).catch(
        (e): GscSiteReport => ({ siteId: site.id, domain: site.domain, color: site.color, property: propertyFor(site), ok: false, error: (e as Error).message, days: [], clicks: 0, impressions: 0 }),
      );
      if (report.ok) cache.set(key, { at: Date.now(), report });
      return report;
    }),
  );
}
