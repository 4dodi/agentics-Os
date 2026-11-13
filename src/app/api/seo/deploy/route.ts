import type { SeoDeploy } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { deploySite } from "@/lib/netlify";
import { listPosts, markDeployed, postUrl } from "@/lib/seo";
import { newId, readJson, updateJson } from "@/lib/store";
import { logActivity } from "@/lib/activity";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";
const FILE = "seo/deploys.json";

export async function GET() {
  return json(await readJson<SeoDeploy[]>(FILE, []));
}

/** Deploy one or more sites in the background; poll GET for progress. */
export async function POST(req: Request) {
  const { siteIds } = await body<{ siteIds?: string[] }>(req);
  const s = await getSettings();
  if (!s.seo.netlifyToken) return fail("Add a Netlify personal access token in Settings → SEO first");
  const sites = s.seo.sites.filter((x) => x.domain && Array.isArray(siteIds) && siteIds.includes(x.id));
  if (!sites.length) return fail("no sites selected");

  const records: SeoDeploy[] = sites.map((site) => ({
    id: newId("d_"), ts: Date.now(), siteId: site.id, domain: site.domain, status: "running", ok: false, ms: 0,
  }));
  await updateJson<SeoDeploy[]>(FILE, [], (l) => [...records, ...l].slice(0, 300));

  void (async () => {
    for (const [i, site] of sites.entries()) {
      const rec = records[i];
      const started = Date.now();
      const pending = (await listPosts(site.domain)).filter((p) => !p.deployedAt).sort((a, b) => b.date.localeCompare(a.date));
      let patch: Partial<SeoDeploy>;
      try {
        const r = await deploySite(site, s.seo.netlifyToken, s.seo.preserveExisting);
        await markDeployed(site.domain, pending.map((p) => p.slug), Date.now());
        patch = {
          status: "ok", ok: true, ms: Date.now() - started, deployId: r.deployId, files: r.files, uploaded: r.uploaded,
          url: pending[0] ? postUrl(site, pending[0].slug) : `https://${site.domain}/${site.blogPath}/`,
        };
      } catch (e) {
        patch = { status: "error", ok: false, ms: Date.now() - started, error: (e as Error).message.slice(0, 500) };
      }
      await updateJson<SeoDeploy[]>(FILE, [], (l) => l.map((d) => (d.id === rec.id ? { ...d, ...patch } : d)));
      await logActivity({
        kind: "seo.deploy",
        title: `Deploy ${site.domain}${patch.ok ? "" : " failed"}`,
        detail: patch.ok ? patch.url : patch.error,
        ok: patch.ok,
        href: "/seo?tab=history",
      });
    }
  })();
  return json(records);
}
