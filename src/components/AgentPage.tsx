"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, SquareTerminal } from "lucide-react";
import type { AgentId } from "@/lib/types";
import { AGENT_META } from "@/lib/nav";
import { PageHeader } from "./PageHeader";
import { Tabs } from "./ui";
import { ChatPanel } from "./ChatPanel";
import { ControlRoom } from "./ControlRoom";

type Agent = Exclude<AgentId, "api">;

export function AgentPage({ agent }: { agent: Agent }) {
  const meta = AGENT_META[agent];
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "control" ? "control" : "chat";
  return (
    <>
      <PageHeader title={meta.label} subtitle={meta.blurb} />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(t === "chat" ? `/${agent}` : `/${agent}?tab=control`)}
        tabs={[
          { id: "chat", label: "Chat", icon: MessageSquare },
          { id: "control", label: "Control Room", icon: SquareTerminal },
        ]}
      />
      {tab === "chat" ? <ChatPanel agent={agent} /> : <ControlRoom agent={agent} />}
    </>
  );
}
