import { getSettings } from "@/lib/settings";
import { listPosts, renderPost } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** Render a generated article exactly as it will be published. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = await getSettings();
  const site = s.seo.sites.find((x) => x.id === u.searchParams.get("site"));
  if (!site) return new Response("site not found", { status: 404 });
  const posts = await listPosts(site.domain);
  const post = posts.find((p) => p.slug === u.searchParams.get("slug"));
  const html = post ? await renderPost(site, post, posts) : null;
  if (!html) return new Response("post not found", { status: 404 });
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "sandbox allow-popups allow-popups-to-escape-sandbox; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer" },
  });
}
