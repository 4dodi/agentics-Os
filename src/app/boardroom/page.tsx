import type { Metadata } from "next";
import { BoardroomPage } from "./BoardroomPage";

export const metadata: Metadata = { title: "Boardroom" };

export default function Page() {
  return <BoardroomPage />;
}
