"use client";

import { Rocket, Sparkles } from "lucide-react";
import { Empty, SectionTitle, Spinner } from "@/components/ui";
import { Meta, UrlLink, type SeoData } from "./SeoPage";

export function HistoryTab({ data }: { data: SeoData }) {
  const deploys = data.deploys;
  return (
    <>
      <SectionTitle icon={Rocket} title="Recently deployed" meta={`${deploys.length} deploys logged`}>
        <button className="link-btn" onClick={data.reload}>Refresh</button>
      </SectionTitle>
      {deploys.length ? (
        <div className="grid cols-2">
          {deploys.slice(0, 20).map((d) => (
            <div key={d.id} className="card deploy-card">
              <div className="row between">
                <Meta ts={d.ts} ms={d.status === "running" ? undefined : d.ms} />
                {d.status === "running" ? (
                  <span className="pill warn"><Spinner size={11} /> Deploying</span>
                ) : d.ok ? (
                  <span className="pill okb">✓ OK</span>
                ) : (
                  <span className="pill off">✗ Failed</span>
                )}
              </div>
              <div className="domain" style={{ color: "#c6f36b" }}>{d.domain}</div>
              {d.url && <UrlLink href={d.url} />}
              {d.error && <div className="err" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{d.error}</div>}
              {d.ok && d.files !== undefined && (
                <div className="faint mono" style={{ fontSize: 11.5, marginTop: 8 }}>
                  {d.files} files · {d.uploaded} uploaded
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No deploys yet" />
      )}

      <SectionTitle icon={Sparkles} title="Generate sessions" meta={`${data.sessions.length} sessions logged`} />
      {data.sessions.length ? (
        <div className="stack">
          {data.sessions.slice(0, 30).map((s) => {
            const done = s.articles.filter((a) => a.status === "done");
            return (
              <div key={s.id} className="card session-card">
                <div className="row between">
                  <Meta ts={s.startedAt} ms={s.ms} />
                  <span className={`pill ${s.status === "done" ? "okb" : s.status === "running" || s.status === "partial" ? "warn" : "off"}`}>
                    {s.status === "done" ? "✓ Done" : s.status}
                  </span>
                </div>
                <h3 style={{ margin: "8px 0 2px", fontSize: 18 }}>{s.keyword}</h3>
                <div className="muted" style={{ fontSize: 13.5 }}>
                  slug: {s.slug} · transcript: {s.transcriptLabel} · {s.engine}
                </div>
                <div className="eyebrow" style={{ marginTop: 16 }}>
                  {done.length} of {s.articles.length} articles written
                </div>
                <div className="links">
                  {s.articles.map((a) =>
                    a.status === "done" && a.url ? (
                      <a key={a.siteId} href={a.url} target="_blank" rel="noreferrer" style={{ ["--c" as string]: a.color }}>
                        <span className="sdot" /> {a.url}
                      </a>
                    ) : (
                      <span key={a.siteId} className="l faint" style={{ ["--c" as string]: a.color }}>
                        <span className="sdot" /> {a.domain} — {a.status === "error" ? a.error : a.status}
                      </span>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty title="No sessions yet" />
      )}
    </>
  );
}
