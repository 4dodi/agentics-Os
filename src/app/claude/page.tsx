import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentPage } from "@/components/AgentPage";

export const metadata: Metadata = { title: "Claude" };

export default function Page() {
  return (
    <Suspense>
      <AgentPage agent="claude" />
    </Suspense>
  );
}
