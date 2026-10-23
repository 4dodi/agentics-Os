import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(process.env.AGENTIC_OS_DATA || path.join(process.cwd(), "data"));

export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function dataPath(...parts: string[]): string {
  return path.join(DATA_DIR, ...parts);
}

export function newId(prefix = ""): string {
  return prefix + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
}

// Serialise writes per file so concurrent requests can't interleave read-modify-write cycles.
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(dataPath(name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  const file = dataPath(name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

/** Atomically read, transform and write a JSON store. Returns the new value. */
export function updateJson<T>(name: string, fallback: T, fn: (current: T) => T | Promise<T>): Promise<T> {
  return withLock(name, async () => {
    const current = await readJson<T>(name, fallback);
    const next = await fn(current);
    await writeJson(name, next);
    return next;
  });
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
