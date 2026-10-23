import { Suspense } from "react";
import type { Metadata } from "next";
import { JournalPage } from "./JournalPage";

export const metadata: Metadata = { title: "Journal" };

export default function Page() {
  return (
    <Suspense>
      <JournalPage />
    </Suspense>
  );
}
