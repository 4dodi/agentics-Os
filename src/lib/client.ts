"use client";

/** fetch wrapper for our own API: JSON in/out, CSRF header, readable errors. */
export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      "x-agentic-os": "1",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers || {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && typeof data === "object" && "error" in data ? (data as { error: string }).error : text) || res.statusText;
    throw new Error(msg);
  }
  return data as T;
}

/** POST and consume an NDJSON stream, calling onEvent for each line. */
export async function streamNdjson(url: string, payload: unknown, onEvent: (ev: any) => void, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-agentic-os": "1", "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    let msg = t;
    try {
      msg = JSON.parse(t).error ?? t;
    } catch {
      /* plain text */
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

export function mediaUrl(file: string, download = false) {
  return `/api/media/file?path=${encodeURIComponent(file)}${download ? "&download=1" : ""}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function fmtDuration(ms?: number): string {
  if (ms === undefined) return "";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function localDate(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export function cityFromTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return (tz.split("/").pop() || "local").replace(/_/g, " ");
  } catch {
    return "local";
  }
}

export function timeUntil(ts: number): string {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 30) return "due now";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}
