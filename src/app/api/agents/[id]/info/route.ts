import { getAgent, agentStatus } from "@/lib/agents";
import { hermesInfo } from "@/lib/agents/hermes";
import { openclawInfo } from "@/lib/agents/openclaw";
import { getSettings } from "@/lib/settings";
import type { AgentId } from "@/lib/types";
import { fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return fail("unknown agent", 404);
  const s = await getSettings();
  const status = await agentStatus(id as AgentId, s);
  const extra =
    id === "hermes" ? await hermesInfo(s) : id === "openclaw" ? await openclawInfo(s) : id === "claude" ? { cwd: s.agents.claude.cwd || process.cwd() } : {};
  return json({ status, bin: agent.bin(s), ...extra });
}
