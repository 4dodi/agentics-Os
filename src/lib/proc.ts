import { spawn } from "node:child_process";
import { expandHome } from "./store";

/** Split a command-line string into argv, honouring single and double quotes. */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      hasToken = true;
    } else if (/\s/.test(c)) {
      if (hasToken || cur) out.push(cur);
      cur = "";
      hasToken = false;
    } else if (c === "\\" && i + 1 < input.length) {
      cur += input[++i];
    } else {
      cur += c;
    }
  }
  if (hasToken || cur) out.push(cur);
  return out;
}

/** Expand a template like `chat -q {prompt}` into argv. Placeholders are substituted per token, never shell-parsed. */
export function templateArgs(template: string, vars: Record<string, string>): string[] {
  return splitArgs(template).map((tok) => tok.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m)));
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  error?: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
  /** Variables to remove from the inherited environment. */
  unsetEnv?: string[];
  stdin?: string;
}

function spawnChild(bin: string, args: string[], opts: RunOptions) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...opts.env };
  for (const k of opts.unsetEnv ?? []) delete env[k];
  return spawn(expandHome(bin), args, {
    cwd: opts.cwd ? expandHome(opts.cwd) : undefined,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function runProcess(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: Omit<RunResult, "ms" | "stdout" | "stderr">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), ms: Math.round(performance.now() - started) });
    };
    let child: ReturnType<typeof spawnChild>;
    try {
      child = spawnChild(bin, args, opts);
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: "", ms: 0, error: (e as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ code: null, error: `timed out after ${opts.timeoutMs}ms` });
    }, opts.timeoutMs ?? 30_000);
    opts.signal?.addEventListener("abort", () => {
      child.kill("SIGTERM");
      finish({ code: null, error: "aborted" });
    });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e: NodeJS.ErrnoException) =>
      finish({ code: null, error: e.code === "ENOENT" ? `command not found: ${bin}` : e.message }),
    );
    child.on("close", (code) => finish({ code }));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

export type StreamChunk = { stream: "stdout" | "stderr"; text: string } | { exit: number | null; error?: string };

/** Spawn a process and yield its output as it arrives. Kills the child when the signal aborts or the consumer stops. */
export async function* streamProcess(bin: string, args: string[], opts: RunOptions = {}): AsyncGenerator<StreamChunk> {
  const queue: StreamChunk[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const push = (c: StreamChunk) => {
    queue.push(c);
    wake?.();
  };

  let child: ReturnType<typeof spawnChild>;
  try {
    child = spawnChild(bin, args, opts);
  } catch (e) {
    yield { exit: null, error: (e as Error).message };
    return;
  }
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        child.kill("SIGTERM");
        push({ exit: null, error: `timed out after ${Math.round(opts.timeoutMs! / 1000)}s` });
        done = true;
      }, opts.timeoutMs)
    : null;
  const onAbort = () => child.kill("SIGTERM");
  opts.signal?.addEventListener("abort", onAbort);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => push({ stream: "stdout", text }));
  child.stderr.on("data", (text: string) => push({ stream: "stderr", text }));
  child.on("error", (e: NodeJS.ErrnoException) => {
    push({ exit: null, error: e.code === "ENOENT" ? `command not found: ${bin}` : e.message });
    done = true;
  });
  child.on("close", (code) => {
    push({ exit: code });
    done = true;
  });
  if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
  else child.stdin.end();

  try {
    while (true) {
      while (queue.length) {
        const c = queue.shift()!;
        yield c;
        if ("exit" in c) return;
      }
      if (done && !queue.length) return;
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
}

/** Split a stream of text chunks into complete lines. */
export async function* lines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buf = "";
  for await (const c of chunks) {
    buf += c;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
  if (buf) yield buf;
}
