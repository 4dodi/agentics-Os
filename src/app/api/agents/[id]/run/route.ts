import { getAgent } from "@/lib/agents";
import { getSettings } from "@/lib/settings";
import { runProcess, splitArgs } from "@/lib/proc";
import { body, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Control Room console: runs the agent's own binary with the given arguments (no shell). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return fail("unknown agent", 404);
  const s = await getSettings();
  const bin = agent.bin(s);
  if (!bin) return fail(`${agent.name} has no command-line binary`);
  const { args } = await body<{ args?: string }>(req);
  const argv = splitArgs(String(args || "--help"));
  const cwd = id === "claude" ? s.agents.claude.cwd || undefined : undefined;
  const r = await runProcess(bin, argv, { timeoutMs: 120_000, cwd, signal: req.signal });
  return json({ command: [bin, ...argv].join(" "), ...r });
}
