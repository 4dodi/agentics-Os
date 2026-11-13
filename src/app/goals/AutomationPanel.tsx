"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight, Play, Save } from "lucide-react";
import type { AgentId, AutomationRun, AutomationSpec, Goal } from "@/lib/types";
import { api, fmtDuration, timeAgo, timeUntil } from "@/lib/client";
import { Markdown } from "@/components/Markdown";
import { Spinner, useToast } from "@/components/ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT: AutomationSpec = { agent: "claude", prompt: "", every: "week", weekday: 1, time: "09:00", enabled: false, useMemory: true, toJournal: true };

function RunRow({ run }: { run: AutomationRun }) {
  const [open, setOpen] = useState(false);
  const body = run.error || run.output;
  return (
    <div className="run-row">
      <button className="row" onClick={() => setOpen((o) => !o)} disabled={!body} aria-expanded={open}>
        {body ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span style={{ width: 14 }} />}
        <span className={`pill ${run.status === "ok" ? "okb" : run.status === "running" ? "warn" : "off"}`}>
          {run.status === "running" ? <Spinner size={11} /> : run.status === "ok" ? "✓" : "✗"} {run.status}
        </span>
        <span className="faint mono" style={{ fontSize: 11.5 }}>
          {timeAgo(run.startedAt)} · {run.agent} · {run.trigger}
          {run.ms !== undefined && ` · ${fmtDuration(run.ms)}`}
        </span>
      </button>
      {open && body && (
        <div className={run.error ? "err" : ""} style={{ marginTop: 8, fontSize: 14 }}>
          {run.error ? run.error : <Markdown>{body}</Markdown>}
        </div>
      )}
    </div>
  );
}

export function AutomationPanel({ goal, onChange }: { goal: Goal; onChange: (g: Goal) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<AutomationSpec>(goal.automation ?? DEFAULT);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const spec = goal.automation;

  const loadRuns = useCallback(
    () => api<AutomationRun[]>(`/api/automations?goalId=${goal.id}&limit=5`).then(setRuns).catch(() => {}),
    [goal.id],
  );
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // While a run is going, poll until it finishes, then refresh the goal (last status, next run).
  const busy = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const next = await api<AutomationRun[]>(`/api/automations?goalId=${goal.id}&limit=5`).catch(() => null);
      if (!next) return;
      setRuns(next);
      if (!next.some((r) => r.status === "running")) {
        const goals = await api<Goal[]>("/api/goals").catch(() => null);
        const fresh = goals?.find((x) => x.id === goal.id);
        if (fresh) onChange(fresh);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [busy, goal.id, onChange]);

  const set = <K extends keyof AutomationSpec>(k: K, v: AutomationSpec[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  async function save(extra: Partial<AutomationSpec> = {}) {
    setSaving(true);
    try {
      const g = await api<Goal>("/api/goals", { method: "PATCH", json: { id: goal.id, automation: { ...draft, ...extra } } });
      onChange(g);
      if (g.automation) setDraft(g.automation);
      setDirty(false);
      return true;
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (dirty && !(await save())) return;
    try {
      const run = await api<AutomationRun>("/api/automations", { method: "POST", json: { id: goal.id } });
      setRuns((r) => [run, ...r].slice(0, 5));
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <div className="automation-panel">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="eyebrow row" style={{ gap: 6 }}>
          <CalendarClock size={13} /> Schedule
        </div>
        <span className="faint mono" style={{ fontSize: 11.5 }}>
          {spec?.enabled && spec.nextRunAt ? `next ${new Date(spec.nextRunAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${timeUntil(spec.nextRunAt)}` : "not scheduled"}
          {spec?.lastRunAt ? ` · last ${timeAgo(spec.lastRunAt)}` : ""}
        </span>
      </div>

      <label className="field" style={{ marginTop: 10 }}>
        What the agent should do
        <textarea
          className="textarea"
          rows={3}
          value={draft.prompt}
          placeholder="e.g. Read my notes from this week and draft 3 SEO article ideas with a keyword each."
          onChange={(e) => set("prompt", e.target.value)}
        />
      </label>

      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <select className="select sm" aria-label="Agent" value={draft.agent} onChange={(e) => set("agent", e.target.value as AgentId)}>
          <option value="claude">Claude</option>
          <option value="hermes">Hermes</option>
          <option value="openclaw">OpenClaw</option>
          <option value="api">API</option>
        </select>
        <select className="select sm" aria-label="Repeat" value={draft.every} onChange={(e) => set("every", e.target.value as AutomationSpec["every"])}>
          <option value="hour">Every hour</option>
          <option value="day">Every day</option>
          <option value="week">Every week</option>
        </select>
        {draft.every === "week" && (
          <select className="select sm" aria-label="Day" value={draft.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        )}
        {draft.every === "hour" ? (
          <label className="row faint" style={{ gap: 6, fontSize: 13 }}>
            at minute
            <input className="input sm" type="number" min={0} max={59} style={{ width: 72 }} value={Number(draft.time.slice(3))} onChange={(e) => set("time", `00:${String(Math.max(0, Math.min(59, Number(e.target.value) || 0))).padStart(2, "0")}`)} />
          </label>
        ) : (
          <input className="input sm" type="time" aria-label="Time" style={{ width: 120 }} value={draft.time} onChange={(e) => set("time", e.target.value || "09:00")} />
        )}
      </div>

      <div className="row wrap" style={{ gap: 16, marginTop: 10 }}>
        <label className="check"><input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Run on schedule</label>
        <label className="check"><input type="checkbox" checked={draft.useMemory} onChange={(e) => set("useMemory", e.target.checked)} /> Use memory</label>
        <label className="check"><input type="checkbox" checked={draft.toJournal} onChange={(e) => set("toJournal", e.target.checked)} /> Save result to journal</label>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn sm primary" onClick={() => save()} disabled={!dirty || saving}>
          {saving ? <Spinner size={13} /> : <Save size={13} />} Save schedule
        </button>
        <button className="btn sm" onClick={runNow} disabled={busy || !draft.prompt.trim()}>
          {busy ? <Spinner size={13} /> : <Play size={13} />} Run now
        </button>
      </div>

      {runs.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: 12 }}>
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      )}
    </div>
  );
}
