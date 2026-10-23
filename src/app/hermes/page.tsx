import { Suspense } from "react";
import type { Metadata } from "next";
import { AgentPage } from "@/components/AgentPage";

export const metadata: Metadata = { title: "Hermes" };

export default function Page() {
  return (
    <Suspense>
      <AgentPage agent="hermes" />
    </Suspense>
  );
}
