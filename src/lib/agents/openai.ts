import type { ChatEvent } from "../types";

export interface OAMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OAOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: OAMessage[];
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function headers(apiKey?: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  };
}

export function joinUrl(base: string, p: string): string {
  return base.replace(/\/+$/, "") + "/" + p.replace(/^\/+/, "");
}

/** Stream an OpenAI-compatible /chat/completions response as ChatEvents. */
export async function* openaiChatStream(o: OAOptions): AsyncGenerator<ChatEvent> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(joinUrl(o.baseUrl, "chat/completions"), {
      method: "POST",
      headers: headers(o.apiKey, o.headers),
      body: JSON.stringify({ model: o.model, messages: o.messages, stream: true }),
      signal: o.signal,
    });
  } catch (e) {
    yield { type: "error", message: `Could not reach ${o.baseUrl}: ${(e as Error).message}` };
    return;
  }
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    yield { type: "error", message: `HTTP ${res.status}: ${body.slice(0, 400)}` };
    return;
  }

  let text = "";
  const isSse = (res.headers.get("content-type") || "").includes("event-stream");
  if (!isSse) {
    // Some gateways ignore stream:true and return one JSON body.
    const json = await res.json().catch(() => null);
    text = json?.choices?.[0]?.message?.content ?? "";
    if (text) yield { type: "delta", text };
    yield { type: "done", text, ms: Math.round(performance.now() - started) };
    return;
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
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        if (j.error) {
          yield { type: "error", message: j.error.message || JSON.stringify(j.error) };
          return;
        }
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          text += d;
          yield { type: "delta", text: d };
        }
      } catch {
        /* ignore keep-alive / malformed lines */
      }
    }
  }
  yield { type: "done", text, ms: Math.round(performance.now() - started) };
}

/** Quick reachability probe for an OpenAI-compatible server. */
export async function probeModels(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; ms: number; models?: string[]; error?: string }> {
  const started = performance.now();
  try {
    const res = await fetch(joinUrl(baseUrl, "models"), { headers: headers(apiKey), signal: AbortSignal.timeout(4000) });
    const ms = Math.round(performance.now() - started);
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const json = await res.json().catch(() => ({}));
    return { ok: true, ms, models: (json.data || []).map((m: { id: string }) => m.id).slice(0, 50) };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - started), error: (e as Error).message };
  }
}
