"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye, Rocket } from "lucide-react";
import type { SeoDeploy, SeoPost, SeoSite } from "@/lib/types";
import { api, fmtDuration, timeAgo } from "@/lib/client";
import { Empty, Spinner, useToast } from "@/components/ui";
import { NoSites, type SeoData } from "./SeoPage";

interface SitePosts {
  site: SeoSite;
  posts: (SeoPost & { url: string; pending: boolean })[];
  pending: number;
}

export function DeployTab({ data }: { data: SeoData }) {
  const toast = useToast();
  const [info, setInfo] = useState<{ sites: SitePosts[]; hasToken: boolean; preserveExisting: boolean } | null>(null);
  const [deploys, setDeploys] = useState<SeoDeploy[]>(data.deploys);

  const load = () => api<typeof info>("/api/seo/posts").then(setInfo).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const runningIds = new Set(deploys.filter((d) => d.status === "running").map((d) => d.siteId));
  useEffect(() => {
    if (!runningIds.size) return;
    const t = setInterval(async () => {
      const d = await api<SeoDeploy[]>("/api/seo/deploy").catch(() => null);
      if (!d) return;
      setDeploys(d);
      if (!d.some((x) => x.status === "running")) {
        load();
        data.reload();
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningIds.size]);

  async function deploy(siteIds: string[]) {
    try {
      const recs = await api<SeoDeploy[]>("/api/seo/deploy", { method: "POST", json: { siteIds } });
      setDeploys((d) => [...recs, ...d]);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  if (!info) return <Spinner />;
  if (!info.sites.length) return <NoSites />;
  const pendingSites = info.sites.filter((s) => s.pending && s.site.netlifySiteId).map((s) => s.site.id);

  return (
    <>
      {!info.hasToken && (
        <div className="card" style={{ marginBottom: 18, borderColor: "rgba(251,191,36,.4)" }}>
          <strong>Netlify isn&apos;t connected.</strong>{" "}
          <span className="muted">
            Create a personal access token (Netlify → User settings → Applications) and paste it in <Link href="/settings#seo" className="md"><u>Settings → SEO</u></Link>.
          </span>
        </div>
      )}
      <div className="row wrap" style={{ marginBottom: 18 }}>
        <span className="muted" style={{ fontSize: 14 }}>
          {info.preserveExisting
            ? "Deploys keep every file already live on each site and only add/update /blog/."
            : "Deploys replace each site with the generated blog (preserve mode is off)."}
        </span>
        <span className="spacer" />
        <button className="btn primary" disabled={!info.hasToken || !pendingSites.length || runningIds.size > 0} onClick={() => deploy(pendingSites)}>
          <Rocket size={15} /> Deploy all pending ({pendingSites.length})
        </button>
      </div>
      <div className="grid cols-2">
        {info.sites.map(({ site, posts, pending }) => {
          const last = deploys.find((d) => d.siteId === site.id);
          const running = runningIds.has(site.id);
          return (
            <div className="card" key={site.id} style={{ ["--c" as string]: site.color }}>
              <div className="row between">
                <div className="row" style={{ minWidth: 0 }}>
                  <span className="sdot" />
                  <h3 style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{site.domain}</h3>
                </div>
                <button className="btn sm" disabled={!info.hasToken || !site.netlifySiteId || running} onClick={() => deploy([site.id])}>
                  {running ? <Spinner size={13} /> : <Rocket size={13} />} {running ? "Deploying" : "Deploy"}
                </button>
              </div>
              <div className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
                {site.netlifySiteId ? `Netlify: ${site.netlifySiteId}` : "No Netlify site id — set it in Settings"} · {pending} pending
                {last && last.status !== "running" && (
                  <>
                    {" "}· last deploy {timeAgo(last.ts)}{" "}
                    <span className={last.ok ? "ok" : "err"}>{last.ok ? `✓ ${fmtDuration(last.ms)}` : "✗ failed"}</span>
                  </>
                )}
              </div>
              {last?.status === "error" && <div className="err" style={{ fontSize: 13, marginBottom: 10, overflowWrap: "anywhere" }}>{last.error}</div>}
              {posts.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {posts.slice(0, 8).map((p) => (
                    <div key={p.slug} className="row" style={{ minWidth: 0 }}>
                      <span className={`badge ${p.pending ? "" : "ok"}`}>{p.pending ? "pending" : "live"}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={p.title}>{p.title}</span>
                      <a className="btn sm ghost" href={`/api/seo/preview?site=${encodeURIComponent(site.id)}&slug=${encodeURIComponent(p.slug)}`} target="_blank" rel="noreferrer" title="Preview">
                        <Eye size={13} />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No articles yet" />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
