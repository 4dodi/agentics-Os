import type { AgentId } from "@/lib/types";
import { AGENT_META } from "@/lib/nav";

function ClaudeGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 4v16M4 12h16M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4" opacity=".9" />
    </svg>
  );
}

function OpenClawGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M7 6c1.8 3.6 1.8 8.4 0 12M11.5 5c2.3 4.4 2.3 9.6 0 14M16 4c2.8 5.2 2.8 10.8 0 16" />
    </svg>
  );
}

function HermesGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M12 6c-2.5-2-5.5-2-8-.5 2 .3 3.6 1.2 4.5 2.6M12 6c2.5-2 5.5-2 8-.5-2 .3-3.6 1.2-4.5 2.6" />
      <path d="M9.5 11c0 1.4 5 1.4 5 3s-5 1.6-5 3" />
    </svg>
  );
}

export function AgentAvatar({ id, size = "md" }: { id: Exclude<AgentId, "api">; size?: "md" | "lg" }) {
  const px = size === "lg" ? 20 : 15;
  const Glyph = id === "claude" ? ClaudeGlyph : id === "openclaw" ? OpenClawGlyph : HermesGlyph;
  return (
    <span className={`avatar ${size === "lg" ? "lg" : ""}`} style={{ ["--c" as string]: AGENT_META[id].accent }}>
      <Glyph size={px} />
    </span>
  );
}
