import { getSettings } from "./settings";
import { runDue } from "./automations";

const TICK_MS = 30_000;
const g = globalThis as unknown as { __agenticScheduler?: NodeJS.Timeout; __agenticTickBusy?: boolean };

/** Extra background jobs registered by other modules (e.g. OMI auto-import). */
const jobs: { name: string; run: () => Promise<void> }[] = [];
export function addJob(name: string, run: () => Promise<void>) {
  if (!jobs.some((j) => j.name === name)) jobs.push({ name, run });
}

export async function tick(): Promise<void> {
  if (g.__agenticTickBusy) return;
  g.__agenticTickBusy = true;
  try {
    const s = await getSettings();
    await runDue(s).catch((e) => console.error("[scheduler] automations:", (e as Error).message));
    for (const j of jobs) await j.run().catch((e) => console.error(`[scheduler] ${j.name}:`, (e as Error).message));
  } finally {
    g.__agenticTickBusy = false;
  }
}

/** Starts the in-process scheduler once per server. Set AGENTIC_OS_SCHEDULER=off to disable it. */
export function startScheduler() {
  if (g.__agenticScheduler || process.env.AGENTIC_OS_SCHEDULER === "off") return;
  g.__agenticScheduler = setInterval(() => void tick(), TICK_MS);
  g.__agenticScheduler.unref?.();
  setTimeout(() => void tick(), 5_000).unref?.();
}
