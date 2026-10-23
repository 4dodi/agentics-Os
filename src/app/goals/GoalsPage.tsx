"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Circle, Pause, Play, Plus, Trash2, Wand2 } from "lucide-react";
import type { AgentId, Goal } from "@/lib/types";
import { api, timeAgo } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { Empty, SectionTitle, Spinner, Tabs, useToast } from "@/components/ui";

type Filter = "active" | "automation" | "done" | "all";

function GoalCard({ goal, onChange }: { goal: Goal; onChange: (g: Goal | null) => void }) {
  const toast = useToast();
  const [planning, setPlanning] = useState(false);
  const [agent, setAgent] = useState<AgentId>("claude");
  const [newStep, setNewStep] = useState("");

  const patch = async (p: Partial<Goal>) => onChange(await api<Goal>("/api/goals", { method: "PATCH", json: { id: goal.id, ...p } }));
  const toggle = (id: string) => patch({ milestones: goal.milestones.map((m) => (m.id === id ? { ...m, done: !m.done } : m)) });
  const accent = goal.kind === "automation" ? "#22d3ee" : "#c084fc";

  return (
    <div className="card" style={{ ["--accent" as string]: accent }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ fontSize: 10.5 }}>
            {goal.kind === "automation" ? "Weekly automation" : "Goal"} · {goal.status}
            {goal.target && ` · target ${goal.target}`}
          </div>
          <h3 style={{ marginTop: 6, fontSize: 19 }}>{goal.title}</h3>
          {goal.why && <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{goal.why}</div>}
        </div>
        <span className="mono" style={{ fontSize: 26, color: accent }}>{goal.progress}%</span>
      </div>
      <div className="progress" style={{ margin: "14px 0" }}>
        <i style={{ width: `${goal.progress}%` }} />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        {goal.milestones.map((m) => (
          <button key={m.id} className="row" style={{ background: "none", border: 0, cursor: "pointer", textAlign: "left", padding: "3px 0", color: m.done ? "var(--faint)" : "var(--text)" }} onClick={() => toggle(m.id)}>
            {m.done ? <CheckCircle2 size={16} color={accent} style={{ flex: "none" }} /> : <Circle size={16} color="var(--faint)" style={{ flex: "none" }} />}
            <span style={{ textDecoration: m.done ? "line-through" : undefined }}>{m.text}</span>
          </button>
        ))}
      </div>
      <form
        className="row"
        style={{ marginTop: 10 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newStep.trim()) return;
          await patch({ milestones: [...goal.milestones, { id: "", text: newStep.trim(), done: false }] });
          setNewStep("");
        }}
      >
        <input className="input" placeholder="Add a milestone…" value={newStep} onChange={(e) => setNewStep(e.target.value)} style={{ padding: "8px 12px" }} />
      </form>
      {!goal.milestones.length && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="faint" style={{ fontSize: 13 }}>Progress</span>
          <input type="range" min={0} max={100} step={5} value={goal.progress} onChange={(e) => patch({ progress: Number(e.target.value) })} style={{ flex: 1, accentColor: accent }} />
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 14, gap: 8 }}>
        <select className="select" value={agent} onChange={(e) => setAgent(e.target.value as AgentId)} style={{ width: 140, padding: "6px 30px 6px 10px", fontSize: 13 }}>
          <option value="claude">Claude</option>
          <option value="hermes">Hermes</option>
          <option value="openclaw">OpenClaw</option>
          <option value="api">API</option>
        </select>
        <button
          className="btn sm"
          disabled={planning}
          onClick={async () => {
            setPlanning(true);
            try {
              onChange(await api<Goal>("/api/goals/plan", { method: "POST", json: { id: goal.id, agent } }));
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setPlanning(false);
            }
          }}
        >
          {planning ? <Spinner size={13} /> : <Wand2 size={13} />} Plan with agent
        </button>
        <span className="spacer" />
        <span className="faint mono" style={{ fontSize: 11 }}>{timeAgo(goal.updatedAt)}</span>
        {goal.status === "active" ? (
          <button className="btn sm ghost" title="Pause" onClick={() => patch({ status: "paused" })}><Pause size={13} /></button>
        ) : (
          <button className="btn sm ghost" title="Make active" onClick={() => patch({ status: "active" })}><Play size={13} /></button>
        )}
        <button
          className="btn sm ghost danger"
          aria-label="Delete goal"
          onClick={async () => {
            if (!confirm(`Delete “${goal.title}”?`)) return;
            await api(`/api/goals?id=${goal.id}`, { method: "DELETE" });
            onChange(null);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function GoalsPage() {
  const toast = useToast();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<Goal["kind"]>("goal");

  const load = () => api<Goal[]>("/api/goals").then(setGoals).catch(() => setGoals([]));
  useEffect(() => {
    load();
  }, []);

  const replace = (id: string) => (g: Goal | null) => setGoals((l) => (l ? (g ? l.map((x) => (x.id === id ? g : x)) : l.filter((x) => x.id !== id)) : l));
  const shown = (goals ?? []).filter((g) =>
    filter === "all" ? true : filter === "done" ? g.status === "done" : filter === "automation" ? g.kind === "automation" && g.status !== "done" : g.status !== "done",
  );

  return (
    <>
      <PageHeader title="Goals" subtitle="What you're building toward — and one new automation per week to get there." />
      <div className="card">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/goals", { method: "POST", json: { title, why, target, kind } });
              setTitle("");
              setWhy("");
              setTarget("");
              load();
            } catch (err) {
              toast((err as Error).message, true);
            }
          }}
        >
          <div className="row wrap">
            <input className="input" style={{ flex: "2 1 320px" }} placeholder={kind === "automation" ? "Automation to set up this week, e.g. Daily SEO article from my latest video" : "Goal, e.g. 100 clicks/day across my SEO sites"} value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="input" type="date" style={{ flex: "0 1 180px" }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target date" />
          </div>
          <div className="row wrap">
            <input className="input" style={{ flex: "2 1 320px" }} placeholder="Why it matters (agents use this when planning)" value={why} onChange={(e) => setWhy(e.target.value)} />
            <select className="select" style={{ flex: "0 1 180px" }} value={kind} onChange={(e) => setKind(e.target.value as Goal["kind"])}>
              <option value="goal">Goal</option>
              <option value="automation">Weekly automation</option>
            </select>
            <button className="btn primary" type="submit" disabled={!title.trim()}>
              <Plus size={15} /> Add
            </button>
          </div>
        </form>
      </div>

      <SectionTitle icon={Bot} title="Your board" meta={`${(goals ?? []).filter((g) => g.status !== "done").length} open`} />
      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "active", label: "Open" },
          { id: "automation", label: "Automations" },
          { id: "done", label: "Done" },
          { id: "all", label: "All" },
        ]}
      />
      {goals === null ? (
        <Spinner />
      ) : shown.length ? (
        <div className="grid cols-2">
          {shown.map((g) => (
            <GoalCard key={g.id} goal={g} onChange={replace(g.id)} />
          ))}
        </div>
      ) : (
        <Empty title="Nothing here yet">
          Start with one thing. Ask an agent: “Based on what you know about me, what&apos;s the best automation I could set up today?”
        </Empty>
      )}
    </>
  );
}
