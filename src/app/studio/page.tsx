import type { Metadata } from "next";
import { StudioPage } from "./StudioPage";

export const metadata: Metadata = { title: "Studio" };

export default function Page() {
  return <StudioPage />;
}
