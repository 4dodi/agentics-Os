import {
  LayoutGrid, Target, Users, TrendingUp, Wand2, BookOpen, Brain, Sparkles, Settings as SettingsIcon, type LucideIcon,
} from "lucide-react";
import type { AgentId } from "./types";

export interface NavItem {
  href: string;
  label: string;
  accent: string;
  icon?: LucideIcon;
  agent?: Exclude<AgentId, "api">;
  group: "workspace" | "agents" | "self" | "system";
  hint: string;
}

export const AGENT_META: Record<Exclude<AgentId, "api">, { label: string; accent: string; blurb: string }> = {
  claude: { label: "Claude", accent: "#f0884d", blurb: "Direct streaming line to Claude Code. Full tool use, MCPs, plugins." },
  openclaw: { label: "OpenClaw", accent: "#ec4fa0", blurb: "Local agent gateway. Chat one-shot or open the control room." },
  hermes: { label: "Hermes", accent: "#5b9cf6", blurb: "Nous Research agent. Sessions, skills, kanban — and a chat line." },
};

export const NAV: NavItem[] = [
  { href: "/", label: "Mission Control", accent: "#a78bfa", icon: LayoutGrid, group: "workspace", hint: "Status of every agent" },
  { href: "/claude", label: "Claude", accent: AGENT_META.claude.accent, agent: "claude", group: "agents", hint: "Chat with Claude Code" },
  { href: "/openclaw", label: "OpenClaw", accent: AGENT_META.openclaw.accent, agent: "openclaw", group: "agents", hint: "Chat with OpenClaw" },
  { href: "/hermes", label: "Hermes", accent: AGENT_META.hermes.accent, agent: "hermes", group: "agents", hint: "Chat with Hermes" },
  { href: "/boardroom", label: "Boardroom", accent: "#f59e0b", icon: Users, group: "agents", hint: "Ask every agent at once" },
  { href: "/goals", label: "Goals", accent: "#c084fc", icon: Target, group: "self", hint: "Goals & scheduled automations" },
  { href: "/seo", label: "SEO", accent: "#a3e635", icon: TrendingUp, group: "self", hint: "Keyword → 5 articles → Netlify" },
  { href: "/studio", label: "Studio", accent: "#e86fd8", icon: Wand2, group: "self", hint: "Images, videos & speech" },
  { href: "/journal", label: "Journal", accent: "#fbbf24", icon: BookOpen, group: "self", hint: "Daily log in your vault" },
  { href: "/memory", label: "Memory", accent: "#2dd4bf", icon: Brain, group: "self", hint: "Obsidian vault as memory" },
  { href: "/guide", label: "Build Guide", accent: "#818cf8", icon: Sparkles, group: "self", hint: "Setup & workflows" },
  { href: "/settings", label: "Settings", accent: "#94a3b8", icon: SettingsIcon, group: "system", hint: "Agents, vault, Netlify, Studio" },
];

export function navFor(pathname: string): NavItem {
  return NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href))) ?? NAV[0];
}
