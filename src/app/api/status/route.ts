import { AGENT_IDS, type AgentId, type AgentStatus, type StatusResponse } from "@/lib/types";
import { agentStatus } from "@/lib/agents";
import { getSettings, vaultPath } from "@/lib/settings";
import { ensureVault, listNotes } from "@/lib/vault";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSettings();
  const statuses = await Promise.all(AGENT_IDS.map((id) => agentStatus(id, s)));
  const agents = Object.fromEntries(statuses.map((st) => [st.id, st])) as Record<AgentId, AgentStatus>;

  let vault = { path: vaultPath(s), ok: false, notes: 0 };
  try {
    const root = await ensureVault(s);
    vault = { path: root, ok: true, notes: (await listNotes(root)).length };
  } catch {
    /* reported as not ok */
  }

  const lat = statuses.filter((a) => a.online && a.latencyMs !== undefined).map((a) => a.latencyMs!).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null;
  const res: StatusResponse = { ts: Date.now(), agents, vault, p50 };
  return json(res);
}
