import { Suspense } from "react";
import type { Metadata } from "next";
import { MemoryPage } from "./MemoryPage";

export const metadata: Metadata = { title: "Memory" };

export default function Page() {
  return (
    <Suspense>
      <MemoryPage />
    </Suspense>
  );
}
