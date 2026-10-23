import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Agentic OS — Mission Control", template: "%s · Agentic OS" },
  description: "Local operating system for your AI agents: Claude Code, Hermes, OpenClaw, SEO pipeline, Studio and Obsidian memory.",
};

export const viewport: Viewport = { themeColor: "#0a0814", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
