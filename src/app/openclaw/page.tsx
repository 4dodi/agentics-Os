import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentPage } from "@/components/AgentPage";

export const metadata: Metadata = { title: "OpenClaw" };

export default function Page() {
  return (
    <Suspense>
      <AgentPage agent="openclaw" />
    </Suspense>
  );
}
