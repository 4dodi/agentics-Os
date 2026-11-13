"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Brain, Cpu, Gauge, HeartPulse, Radio, Target, Zap } from "lucide-react";
import type { ActivityItem, AgentId, Goal } from "@/lib/types";
import { AGENT_META, NAV } from "@/lib/nav";
import { api, timeAgo } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { useStatus, POLL_MS } from "@/components/StatusProvider";
import { AgentAvatar } from "@/components/icons";
import { Empty, LivePill, SectionTitle } from "@/components/ui";

type Agent = Exclude<AgentId, "api">;
const AGENTS: Agent[] = ["claude", "openclaw", "hermes"];

const KIND_COLOR: Record<ActivityItem["kind"], string> = {
  chat: "#a78bfa",
  "seo.generate": "#a3e635",
  "seo.deploy": "#22d3ee",
  studio: "#e86fd8",
  goal: "#c084fc",
  automation: "#22d3ee",
  boardroom: "#f59e0b",
  journal: "#fbbf24",
  memory: "#2dd4bf",
  system: "#94a3b8",
};

function StatCard({ c, icon: Icon, label, value, sub, online }: { c: string; icon: typeof Cpu; label: string; value: string; sub: string; online: boolean | null }) {
  return (
    <div className="card stat glow" style={{ ["--c" as string]: c }}>
      <div className="top">
        <span className="label">
          <Icon size={14} /> {label}
        </span>
        <LivePill online={online} />
      </div>
      <div className="value">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

export function MissionControl() {
  const { status, ticks } = useStatus();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const load = () => {
      api<ActivityItem[]>("/api/activity?limit=12").then(setActivity).catch(() => {});
    };
    load();
    api<Goal[]>("/api/goals").then(setGoals).catch(() => {});
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const a = status?.agents;
  const agentValue = (id: Agent) => (!a ? "…" : !a[id].enabled ? "DISABLED" : a[id].online ? "ONLINE" : id === "openclaw" ? "…" : "OFFLINE");
  const agentSub = (id: Agent) => {
    if (!a) return "probing…";
    const s = a[id];
    if (id === "claude") return s.online ? `${s.version} · ${s.latencyMs}ms` : s.error || "not found";
    if (id === "openclaw") return s.detail || s.error || "";
    return s.online ? s.model || s.version || "online" : s.error || "not found";
  };
  const activeGoals = goals.filter((g) => g.status === "active");

  return (
    <>
      <PageHeader title="Mission Control" subtitle="Status of every agent, every memory, every signal." />

      <div className="grid cols-3">
        {AGENTS.map((id) => (
          <StatCard
            key={id}
            c={AGENT_META[id].accent}
            icon={id === "claude" ? Zap : id === "openclaw" ? Radio : Cpu}
            label={AGENT_META[id].label}
            value={agentValue(id)}
            sub={agentSub(id)}
            online={a ? a[id].online : null}
          />
        ))}
        <StatCard c="#38bdf8" icon={HeartPulse} label="Heartbeat" value={String(ticks)} sub={`poll ticks · ${POLL_MS / 1000}s`} online={status ? true : null} />
        <StatCard
          c="#34d399"
          icon={Gauge}
          label="Latency"
          value={status?.p50 != null ? `${status.p50}ms` : "—"}
          sub="combined p50"
          online={status ? status.p50 != null : null}
        />
        <StatCard
          c="#2dd4bf"
          icon={Brain}
          label="Memory"
          value={status ? String(status.vault.notes) : "…"}
          sub={status ? (status.vault.ok ? `notes · ${status.vault.path}` : `vault missing · ${status.vault.path}`) : ""}
          online={status ? status.vault.ok : null}
        />
      </div>

      <SectionTitle title="Agents" meta="Click to open control room" />
      <div className="grid cols-3">
        {AGENTS.map((id) => {
          const s = a?.[id];
          const online = s ? s.online : null;
          return (
            <Link key={id} href={`/${id}?tab=control`} className="card agent-card glow" style={{ ["--c" as string]: AGENT_META[id].accent }}>
              <div className="row between">
                <AgentAvatar id={id} size="lg" />
                <LivePill online={online} label={online === null ? "…" : online ? "Online" : s?.enabled === false ? "Disabled" : "Offline"} />
              </div>
              <h3>{AGENT_META[id].label}</h3>
              <p>{AGENT_META[id].blurb}</p>
              <div className="kv">
                {id === "openclaw" ? (
                  <>
                    <div><div className="k">Agents</div><div className="v">{s?.meta?.agents ?? "—"}</div></div>
                    <div><div className="k">Sessions</div><div className="v">{s?.meta?.sessions ?? "—"}</div></div>
                  </>
                ) : id === "hermes" ? (
                  <>
                    <div><div className="k">Model</div><div className="v" title={s?.model}>{s?.model || "—"}</div></div>
                    <div><div className="k">Skills</div><div className="v">{s?.meta?.skills ?? "—"}</div></div>
                  </>
                ) : (
                  <>
                    <div><div className="k">Version</div><div className="v">{s?.version?.split(" ")[0] || "—"}</div></div>
                    <div><div className="k">Latency</div><div className="v">{s?.latencyMs !== undefined ? `${s.latencyMs}ms` : "—"}</div></div>
                  </>
                )}
              </div>
              <span className="open-link">Open control room →</span>
            </Link>
          );
        })}
      </div>

      <div className="grid cols-2" style={{ marginTop: 8 }}>
        <div>
          <SectionTitle icon={Activity} title="Signals" meta="Latest activity" />
          <div className="card">
            {activity.length ? (
              <div className="feed">
                {activity.map((it) => (
                  <Link key={it.id} href={it.href || "#"} className="feed-item" style={{ ["--c" as string]: it.ok === false ? "var(--err)" : KIND_COLOR[it.kind] }}>
                    <span className="d" />
                    <span className="t">
                      <span className="faint mono" style={{ fontSize: 11, marginRight: 8 }}>
                        {it.agent ? AGENT_META[it.agent as Agent]?.label ?? it.agent : it.kind}
                      </span>
                      {it.title}
                    </span>
                    <span className="when">{timeAgo(it.ts)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="No signals yet">Chat with an agent, generate articles or write a journal entry.</Empty>
            )}
          </div>
        </div>
        <div>
          <SectionTitle icon={Target} title="Goals" meta={`${activeGoals.length} active`} />
          <div className="card">
            {activeGoals.length ? (
              <div className="stack">
                {activeGoals.slice(0, 6).map((g) => (
                  <Link href="/goals" key={g.id} className="stack" style={{ gap: 6 }}>
                    <div className="row between">
                      <span>{g.title}</span>
                      <span className="mono faint" style={{ fontSize: 12 }}>{g.progress}%</span>
                    </div>
                    <div className="progress" style={{ ["--accent" as string]: g.kind === "automation" ? "#22d3ee" : "#c084fc" }}>
                      <i style={{ width: `${g.progress}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="No active goals">
                <Link className="btn sm" href="/goals" style={{ marginTop: 10 }}>Set one goal — one automation a week</Link>
              </Empty>
            )}
          </div>
          <SectionTitle title="Jump to" />
          <div className="row wrap">
            {NAV.filter((n) => n.group === "self").map((n) => (
              <Link key={n.href} href={n.href} className="btn sm" style={{ ["--accent" as string]: n.accent }}>
                {n.icon && <n.icon size={14} color={n.accent} />} {n.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
