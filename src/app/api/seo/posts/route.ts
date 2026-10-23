import { getSettings } from "@/lib/settings";
import { listPosts, postUrl } from "@/lib/seo";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Every site with its generated posts and how many are waiting to be deployed. */
export async function GET() {
  const s = await getSettings();
  const sites = await Promise.all(
    s.seo.sites.map(async (site) => {
      const posts = (await listPosts(site.domain)).sort((a, b) => b.date.localeCompare(a.date));
      return {
        site,
        posts: posts.map((p) => ({ ...p, url: postUrl(site, p.slug), pending: !p.deployedAt })),
        pending: posts.filter((p) => !p.deployedAt).length,
      };
    }),
  );
  return json({ sites, hasToken: Boolean(s.seo.netlifyToken), preserveExisting: s.seo.preserveExisting });
}
