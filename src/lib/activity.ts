import type { ActivityItem } from "./types";
import { newId, readJson, updateJson } from "./store";

const FILE = "activity.json";
const MAX = 1000;

export async function logActivity(item: Omit<ActivityItem, "id" | "ts"> & { ts?: number }): Promise<void> {
  await updateJson<ActivityItem[]>(FILE, [], (list) =>
    [{ id: newId("a_"), ts: Date.now(), ...item }, ...list].slice(0, MAX),
  ).catch(() => undefined);
}

export async function listActivity(limit = 50, since?: number, until?: number): Promise<ActivityItem[]> {
  const list = await readJson<ActivityItem[]>(FILE, []);
  return list.filter((a) => (since ? a.ts >= since : true) && (until ? a.ts < until : true)).slice(0, limit);
}
