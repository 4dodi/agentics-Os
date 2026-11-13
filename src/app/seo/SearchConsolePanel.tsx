"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, RefreshCw, Table2 } from "lucide-react";
import type { GscSiteReport } from "@/lib/types";
import { api } from "@/lib/client";
import { SectionTitle, Spinner } from "@/components/ui";
import { ClicksChart, fmtNum } from "./ClicksChart";

interface Report {
  configured: boolean;
  days?: number;
  sites: GscSiteReport[];
}

const RANGES = [7, 28, 90] as const;

/** Search Console clicks per site: one range filter, a hero total, small multiples and a table view. */
export function SearchConsolePanel() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(28);
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [table, setTable] = useState(false);

  const load = (fresh = false) => {
    setLoading(true);
    api<Report>(`/api/seo/gsc?days=${range}${fresh ? "&fresh=1" : ""}`)
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const sites = data?.sites ?? [];
  const ok = sites.filter((s) => s.ok);
  const clicks = ok.reduce((a, s) => a + s.clicks, 0);
  const impressions = ok.reduce((a, s) => a + s.impressions, 0);

  return (
    <>
      <SectionTitle icon={BarChart3} title="Search Console" meta={data?.configured ? `last ${range} days · clicks per day` : undefined}>
        {data?.configured && (
          <button className="link-btn" onClick={() => load(true)} disabled={loading}>
            {loading ? <Spinner size={12} /> : <RefreshCw size={12} />} Refresh
          </button>
        )}
      </SectionTitle>

      {data && !data.configured ? (
        <div className="card muted" style={{ fontSize: 14 }}>
          See clicks for every site here. Create a Google Cloud service account, download its JSON key, add its email as a user on
          each Search Console property, then paste the key in <Link href="/settings#seo">Settings → SEO</Link>.
        </div>
      ) : err && !data ? (
        <div className="card err" style={{ fontSize: 14 }}>{err}</div>
      ) : !data ? (
        <Spinner />
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
          <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
            <div className="seg" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? "on" : ""} aria-pressed={r === range} onClick={() => setRange(r)}>
                  {r} days
                </button>
              ))}
            </div>
            <button className={`btn sm ${table ? "primary" : "ghost"}`} aria-pressed={table} onClick={() => setTable((t) => !t)}>
              <Table2 size={13} /> Table
            </button>
          </div>

          <div className="card gsc-hero">
            <div className="faint" style={{ fontSize: 13 }}>Clicks, all sites</div>
            <div className="hero-num">{fmtNum(clicks)}</div>
            <div className="muted" style={{ fontSize: 13.5 }}>
              {fmtNum(impressions)} impressions · {impressions ? ((clicks / impressions) * 100).toFixed(1) : "0.0"}% CTR · {ok.length} of {sites.length} sites reporting
            </div>
          </div>

          {table ? (
            <GscTable sites={ok} />
          ) : (
            <div className="grid cols-2" style={{ marginTop: 14 }}>
              {sites.map((s) => (
                <div key={s.siteId} className="card gsc-site">
                  <div className="row between" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <i className="key" style={{ background: s.color }} />
                      <span className="domain" style={{ overflowWrap: "anywhere" }}>{s.domain}</span>
                    </div>
                    {s.ok && (
                      <span className="mono" style={{ fontSize: 13 }}>
                        <strong>{fmtNum(s.clicks)}</strong> <span className="faint">clicks</span>
                      </span>
                    )}
                  </div>
                  {s.ok ? (
                    <ClicksChart days={s.days} color={s.color} label={`${s.domain} clicks per day`} />
                  ) : (
                    <div className="err" style={{ fontSize: 13, marginTop: 10, overflowWrap: "anywhere" }}>
                      {s.property}: {s.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function GscTable({ sites }: { sites: GscSiteReport[] }) {
  if (!sites.length) return <div className="card muted" style={{ marginTop: 14 }}>No site is reporting yet.</div>;
  const dates = sites[0].days.map((d) => d.date).reverse();
  return (
    <div className="card tight" style={{ marginTop: 14, overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            {sites.map((s) => (
              <th key={s.siteId} scope="col">{s.domain}<div className="faint" style={{ fontWeight: 400 }}>clicks / impressions</div></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => (
            <tr key={date}>
              <th scope="row">{date}</th>
              {sites.map((s) => {
                const d = s.days.find((x) => x.date === date);
                return <td key={s.siteId}>{d ? `${fmtNum(d.clicks)} / ${fmtNum(d.impressions)}` : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
