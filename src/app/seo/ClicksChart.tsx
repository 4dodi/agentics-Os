"use client";

import { useEffect, useRef, useState } from "react";
import type { GscDay } from "@/lib/types";

const H = 132;
const PAD = { top: 18, right: 44, bottom: 22, left: 8 };

export function fmtNum(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

/** Round up to a clean axis maximum: 1, 2, 5 × 10^n. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * One site's daily clicks: a 2px line over a 10% wash, a ringed end-dot with the latest value,
 * and a crosshair tooltip (pointer or arrow keys) that shows clicks and impressions for the day.
 */
export function ClicksChart({ days, color, label }: { days: GscDay[]; color: string; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!days.length) return null;
  const max = niceMax(Math.max(...days.map((d) => d.clicks)));
  const iw = w - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.clicks).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  const area = `${line}L${x(days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const last = days.length - 1;
  const hi = hover ?? null;

  const pick = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const t = (clientX - r.left - PAD.left) / iw;
    setHover(Math.max(0, Math.min(last, Math.round(t * last))));
  };

  const total = days.reduce((a, d) => a + d.clicks, 0);
  return (
    <div ref={wrap} className="clicks-chart" style={{ position: "relative" }}>
      <svg
        width={w}
        height={H}
        role="img"
        tabIndex={0}
        aria-label={`${label}: ${fmtNum(total)} clicks from ${shortDate(days[0].date)} to ${shortDate(days[last].date)}, latest day ${fmtNum(days[last].clicks)}. Use arrow keys to read each day.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setHover((h) => Math.max(0, Math.min(last, (h ?? last) + (e.key === "ArrowLeft" ? -1 : 1))));
          }
        }}
      >
        {/* recessive hairline grid: baseline and the top tick */}
        <line x1={PAD.left} x2={PAD.left + iw} y1={y(max)} y2={y(max)} className="grid" />
        <line x1={PAD.left} x2={PAD.left + iw} y1={y(0)} y2={y(0)} className="grid" />
        <text x={PAD.left + iw + 8} y={y(max) + 4} className="tick">{fmtNum(max)}</text>
        <text x={PAD.left + iw + 8} y={y(0) + 4} className="tick">0</text>
        <text x={PAD.left} y={H - 4} className="tick">{shortDate(days[0].date)}</text>
        <text x={PAD.left + iw} y={H - 4} className="tick" textAnchor="end">{shortDate(days[last].date)}</text>

        <path d={area} fill={color} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={PAD.top - 6} y2={y(0)} className="crosshair" />}
        {hi !== null && hi !== last && <circle cx={x(hi)} cy={y(days[hi].clicks)} r={4} fill={color} className="ring" />}
        <circle cx={x(last)} cy={y(days[last].clicks)} r={4} fill={color} className="ring" />
        {hi === null && (
          <text x={x(last)} y={y(days[last].clicks) - 9} className="end-label" textAnchor="end">
            {fmtNum(days[last].clicks)}
          </text>
        )}
      </svg>
      {hi !== null && (
        <div className="chart-tip" style={{ left: x(hi) > w / 2 ? x(hi) - 150 : x(hi) + 10, top: PAD.top - 6 }} role="status">
          <div className="faint" style={{ fontSize: 11.5 }}>{shortDate(days[hi].date)}</div>
          <div className="row" style={{ gap: 6 }}>
            <i className="key" style={{ background: color }} />
            <strong>{fmtNum(days[hi].clicks)}</strong>
            <span className="muted">clicks</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{fmtNum(days[hi].impressions)} impressions</div>
        </div>
      )}
    </div>
  );
}
