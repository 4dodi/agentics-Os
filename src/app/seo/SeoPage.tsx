"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookText, Clock, ExternalLink, FileText, History, Rocket, Sparkles } from "lucide-react";
import type { SeoDeploy, SeoSession, Transcript } from "@/lib/types";
import { api, fmtDuration, timeAgo } from "@/lib/client";
import { PageHeader } from "@/components/PageHeader";
import { Tabs } from "@/components/ui";
import { GenerateTab } from "./GenerateTab";
import { DeployTab } from "./DeployTab";
import { HistoryTab } from "./HistoryTab";
import { TranscriptsTab } from "./TranscriptsTab";
import { SkillTab } from "./SkillTab";

type Tab = "generate" | "deploy" | "history" | "transcripts" | "skill";
const TABS: Tab[] = ["generate", "deploy", "history", "transcripts", "skill"];

export interface SeoData {
  sessions: SeoSession[];
  deploys: SeoDeploy[];
  transcripts: Transcript[];
  reload: () => void;
}

export function SeoPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "generate") as Tab;
  const [sessions, setSessions] = useState<SeoSession[]>([]);
  const [deploys, setDeploys] = useState<SeoDeploy[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);

  const reload = useCallback(() => {
    api<SeoSession[]>("/api/seo/sessions").then(setSessions).catch(() => {});
    api<SeoDeploy[]>("/api/seo/deploy").then(setDeploys).catch(() => {});
    api<Transcript[]>("/api/seo/transcripts").then(setTranscripts).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const data: SeoData = { sessions, deploys, transcripts, reload };
  const setTab = (t: Tab, extra = "") => router.replace(`/seo?tab=${t}${extra}`);

  return (
    <>
      <PageHeader title="SEO Content Pipeline" subtitle="Pick a keyword + transcript. Generate 5 unique articles. Deploy to your Netlify funnel." />
      <Tabs
        value={tab}
        onChange={(t) => setTab(t)}
        tabs={[
          { id: "generate", label: "Generate", icon: Sparkles },
          { id: "deploy", label: "Deploy", icon: Rocket },
          { id: "history", label: "History", icon: History, count: sessions.length + deploys.filter((d) => d.status !== "running").length },
          { id: "transcripts", label: "Transcripts", icon: FileText, count: transcripts.length || undefined },
          { id: "skill", label: "Skill", icon: BookText },
        ]}
      />
      {tab === "generate" && <GenerateTab data={data} goDeploy={() => setTab("deploy")} preselect={params.get("transcript") || undefined} />}
      {tab === "deploy" && <DeployTab data={data} />}
      {tab === "history" && <HistoryTab data={data} />}
      {tab === "transcripts" && <TranscriptsTab data={data} use={(id) => setTab("generate", `&transcript=${id}`)} />}
      {tab === "skill" && <SkillTab />}
    </>
  );
}

export function NoSites() {
  return (
    <div className="empty">
      <h3>Add your sites first</h3>
      <p>Each article goes to one site. Add your domains (and their Netlify site ids) in Settings.</p>
      <Link href="/settings#seo" className="btn primary" style={{ marginTop: 8 }}>
        Open Settings → SEO
      </Link>
    </div>
  );
}

export function Meta({ ts, ms }: { ts: number; ms?: number }) {
  return (
    <span className="eyebrow row" style={{ gap: 6, fontSize: 11 }}>
      <Clock size={12} /> {timeAgo(ts)}
      {ms !== undefined && ` · ${fmtDuration(ms)}`}
    </span>
  );
}

export function UrlLink({ href }: { href: string }) {
  return (
    <a className="url" href={href} target="_blank" rel="noreferrer">
      <ExternalLink size={14} /> {href}
    </a>
  );
}
