import type { AgentId, AutomationRun, AutomationSpec, Goal, Settings } from "./types";
import { AGENT_IDS } from "./types";
import { newId, readJson, updateJson } from "./store";
import { AGENTS, agentEnabled, complete } from "./agents";
import { buildMemoryContext } from "./vault";
import { appendToJournal } from "./journal";
import { logActivity } from "./activity";

export const GOALS_FILE = "goals.json";
export const RUNS_FILE = "automations/runs.json";
const MAX_RUNS = 300;
const RUN_TIMEOUT_MS = 30 * 60_000;

export const DEFAULT_SPEC: AutomationSpec = {
  agent: "claude",
  prompt: "",
  every: "week",
  weekday: 1,
  time: "09:00",
  enabled: false,
  useMemory: true,
  toJournal: true,
};

function parseTime(t: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  const h = m ? Math.min(23, Number(m[1])) : 9;
  const min = m ? Math.min(59, Number(m[2])) : 0;
  return [h, min];
}

/** Validate an automation spec coming from the browser; unknown values fall back to defaults. */
export function cleanSpec(raw: unknown, prev?: AutomationSpec): AutomationSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AutomationSpec>;
  const base = prev ?? DEFAULT_SPEC;
  const [h, m] = parseTime(typeof r.time === "string" ? r.time : base.time);
  return {
    agent: AGENT_IDS.includes(r.agent as AgentId) ? (r.agent as AgentId) : base.agent,
    prompt: typeof r.prompt === "string" ? r.prompt.slice(0, 20_000) : base.prompt,
    every: r.every === "hour" || r.every === "day" || r.every === "week" ? r.every : base.every,
    weekday: Number.isInteger(r.weekday) && r.weekday! >= 0 && r.weekday! <= 6 ? r.weekday! : base.weekday,
    time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
    useMemory: typeof r.useMemory === "boolean" ? r.useMemory : base.useMemory,
    toJournal: typeof r.toJournal === "boolean" ? r.toJournal : base.toJournal,
    lastRunAt: prev?.lastRunAt,
    lastStatus: prev?.lastStatus,
  };
}

/** The first scheduled moment strictly after `from` (server local time). */
export function nextRun(spec: Pick<AutomationSpec, "every" | "weekday" | "time">, from: number): number {
  const [h, m] = parseTime(spec.time);
  const d = new Date(from);
  d.setSeconds(0, 0);
  if (spec.every === "hour") {
    d.setMinutes(m);
    if (d.getTime() <= from) d.setHours(d.getHours() + 1);
    return d.getTime();
  }
  d.setHours(h, m, 0, 0);
  if (spec.every === "day") {
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  let add = (spec.weekday - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() <= from) add = 7;
  d.setDate(d.getDate() + add);
  return d.getTime();
}

export function describeSchedule(spec: Pick<AutomationSpec, "every" | "weekday" | "time">): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (spec.every === "hour") return `every hour at :${spec.time.slice(3)}`;
  if (spec.every === "day") return `every day at ${spec.time}`;
  return `every ${days[spec.weekday]} at ${spec.time}`;
}

/** Apply a spec update to a goal: keep run history, recompute the next run. */
export function withSpec(goal: Goal, raw: unknown, now = Date.now()): Goal {
  const spec = cleanSpec(raw, goal.automation);
  spec.nextRunAt = spec.enabled ? nextRun(spec, now) : undefined;
  return { ...goal, automation: spec };
}

// ---------------------------------------------------------------- running

const g = globalThis as unknown as { __automationsRunning?: Set<string> };
const running = (g.__automationsRunning ??= new Set());

async function patchGoal(id: string, fn: (goal: Goal) => Goal) {
  await updateJson<Goal[]>(GOALS_FILE, [], (l) => l.map((x) => (x.id === id ? fn(x) : x)));
}

async function patchRun(id: string, p: Partial<AutomationRun>) {
  await updateJson<AutomationRun[]>(RUNS_FILE, [], (l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
}

export async function listRuns(goalId?: string, limit = 50): Promise<AutomationRun[]> {
  const runs = await readJson<AutomationRun[]>(RUNS_FILE, []);
  return (goalId ? runs.filter((r) => r.goalId === goalId) : runs).slice(0, limit);
}

/**
 * Run one automation now. Returns the run record immediately; the agent works in the background.
 * A goal never runs twice at the same time.
 */
export async function startRun(goalId: string, trigger: AutomationRun["trigger"], s: Settings): Promise<AutomationRun> {
  const goal = (await readJson<Goal[]>(GOALS_FILE, [])).find((x) => x.id === goalId);
  if (!goal || goal.kind !== "automation") throw new Error("automation not found");
  const spec = goal.automation;
  if (!spec?.prompt.trim()) throw new Error("Give this automation a prompt first");
  if (!agentEnabled(spec.agent, s)) throw new Error(`${AGENTS[spec.agent].name} is disabled in Settings → Agents`);
  if (running.has(goalId)) throw new Error("This automation is already running");
  running.add(goalId);

  const run: AutomationRun = { id: newId("run_"), goalId, title: goal.title, agent: spec.agent, trigger, startedAt: Date.now(), status: "running" };
  await updateJson<AutomationRun[]>(RUNS_FILE, [], (l) => [run, ...l].slice(0, MAX_RUNS));
  // Schedule the next slot up front, so a slow or failing run can't fire again on the next tick.
  await patchGoal(goalId, (x) => ({
    ...x,
    automation: x.automation && {
      ...x.automation,
      lastStatus: "running",
      lastRunAt: run.startedAt,
      nextRunAt: x.automation.enabled ? nextRun(x.automation, run.startedAt) : undefined,
    },
  }));

  void (async () => {
    let status: AutomationRun["status"] = "ok";
    let output = "";
    let error: string | undefined;
    try {
      const context = [`Automation: ${goal.title}`, goal.why && `Why it matters: ${goal.why}`].filter(Boolean).join("\n");
      const mem = spec.useMemory ? await buildMemoryContext(`${goal.title} ${spec.prompt}`, s) : { text: "" };
      const system = [context, mem.text].filter(Boolean).join("\n\n");
      output = (await complete(spec.agent, { prompt: spec.prompt, system, timeoutMs: RUN_TIMEOUT_MS }, s)).trim();
      if (spec.toJournal && output) {
        await appendToJournal(s, "Automations", `### ${goal.title} (${spec.agent})\n${output}`).catch(() => undefined);
      }
    } catch (e) {
      status = "error";
      error = (e as Error).message.slice(0, 2000);
    } finally {
      running.delete(goalId);
    }
    const ms = Date.now() - run.startedAt;
    await patchRun(run.id, { status, ms, output: output.slice(0, 20_000) || undefined, error });
    await patchGoal(goalId, (x) => ({ ...x, automation: x.automation && { ...x.automation, lastStatus: status } }));
    await logActivity({
      kind: "automation",
      agent: spec.agent,
      title: `${goal.title}${status === "ok" ? "" : " failed"}`,
      detail: error ? error.slice(0, 200) : `${Math.round(ms / 100) / 10}s · ${trigger}`,
      ok: status === "ok",
      href: "/goals?filter=automation",
    });
  })();
  return run;
}

/** Start every enabled automation whose time has come. Missed slots (app was closed) run once, then reschedule. */
export async function runDue(s: Settings, now = Date.now()): Promise<string[]> {
  const goals = await readJson<Goal[]>(GOALS_FILE, []);
  const started: string[] = [];
  for (const goal of goals) {
    const spec = goal.automation;
    if (goal.kind !== "automation" || goal.status !== "active" || !spec?.enabled || !spec.prompt.trim()) continue;
    if (!spec.nextRunAt) {
      await patchGoal(goal.id, (x) => ({ ...x, automation: x.automation && { ...x.automation, nextRunAt: nextRun(x.automation, now) } }));
      continue;
    }
    // A disabled agent waits: the missed slot runs once it's switched back on.
    if (spec.nextRunAt > now || running.has(goal.id) || !agentEnabled(spec.agent, s)) continue;
    try {
      await startRun(goal.id, "schedule", s);
      started.push(goal.id);
    } catch {
      /* logged by startRun or not runnable */
    }
  }
  return started;
}
