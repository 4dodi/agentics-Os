import { Suspense } from "react";
import type { Metadata } from "next";
import { SeoPage } from "./SeoPage";

export const metadata: Metadata = { title: "SEO" };

export default function Page() {
  return (
    <Suspense>
      <SeoPage />
    </Suspense>
  );
}
