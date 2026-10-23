import type { ChatEvent } from "../types";
import { runProcess, splitArgs, streamProcess, lines } from "../proc";
import { type Agent, offline } from "./base";

// When Agentic OS itself is started from a Claude Code terminal, these would make every
// spawned `claude` think it's a nested child of that session.
const PARENT_SESSION_ENV = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID"];

/**
 * Claude Code via `claude -p --output-format stream-json`.
 * Token deltas come from `stream_event` lines (requires --include-partial-messages);
 * the final `result` line carries the session id we pass back with --resume.
 */
export const claudeAgent: Agent = {
  id: "claude",
  name: "Claude",
  supportsSessions: true,

  bin: (s) => s.agents.claude.bin,

  async status(s) {
    const c = s.agents.claude;
    if (!c.enabled) return offline("claude", "Claude", false, "disabled");
    const r = await runProcess(c.bin, ["--version"], { timeoutMs: 8000 });
    if (r.error || r.code !== 0) return offline("claude", "Claude", true, r.error || r.stderr.trim() || "not responding");
    const version = r.stdout.trim().split("\n")[0];
    return {
      id: "claude",
      name: "Claude",
      enabled: true,
      online: true,
      version,
      latencyMs: r.ms,
      model: c.model || "default model",
      detail: `${version} · ${r.ms}ms`,
    };
  },

  async *chat(req, s): AsyncGenerator<ChatEvent> {
    const c = s.agents.claude;
    // Prompt goes through stdin: no argv length limits and no risk of it being parsed as a flag.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    if (req.sessionId) args.push("--resume", req.sessionId);
    if (c.model) args.push("--model", c.model);
    if (c.permissionMode && c.permissionMode !== "default") args.push("--permission-mode", c.permissionMode);
    if (req.system) args.push("--append-system-prompt", req.system);
    args.push(...splitArgs(c.extraArgs || ""));

    const started = performance.now();
    let text = "";
    let sessionId: string | undefined;
    let stderr = "";
    let sawDeltaForMessage = false;
    let resultError: string | null = null;
    let resultText: string | null = null;

    const proc = streamProcess(c.bin, args, {
      cwd: c.cwd || undefined,
      signal: req.signal,
      timeoutMs: req.timeoutMs ?? 30 * 60_000,
      stdin: req.prompt,
      unsetEnv: PARENT_SESSION_ENV,
    });

    let exit: { exit: number | null; error?: string } | null = null;
    async function* stdout() {
      for await (const chunk of proc) {
        if ("exit" in chunk) {
          exit = chunk;
          return;
        }
        if (chunk.stream === "stderr") stderr += chunk.text;
        else yield chunk.text;
      }
    }

    for await (const line of lines(stdout())) {
      if (!line.trim()) continue;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "system" && ev.subtype === "init" && ev.session_id) {
        sessionId = ev.session_id;
        yield { type: "session", id: ev.session_id };
      } else if (ev.type === "stream_event") {
        const e = ev.event || {};
        if (ev.parent_tool_use_id) continue; // sub-agent chatter
        if (e.type === "message_start") {
          sawDeltaForMessage = false;
          if (text && !text.endsWith("\n\n")) {
            const sep = text.endsWith("\n") ? "\n" : "\n\n";
            text += sep;
            yield { type: "delta", text: sep };
          }
        } else if (e.type === "content_block_start" && e.content_block?.type === "tool_use") {
          yield { type: "tool", name: e.content_block.name };
        } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
          sawDeltaForMessage = true;
          text += e.delta.text;
          yield { type: "delta", text: e.delta.text };
        }
      } else if (ev.type === "assistant" && !ev.parent_tool_use_id && !sawDeltaForMessage) {
        // Older CLIs without partial messages: take the whole text block.
        for (const block of ev.message?.content || []) {
          if (block.type === "text" && block.text) {
            text += block.text;
            yield { type: "delta", text: block.text };
          } else if (block.type === "tool_use") {
            yield { type: "tool", name: block.name };
          }
        }
      } else if (ev.type === "result") {
        sessionId = ev.session_id || sessionId;
        if (ev.is_error) resultError = String(ev.result || ev.subtype || "Claude returned an error");
        else if (typeof ev.result === "string") resultText = ev.result;
      }
    }

    const ex = exit as { exit: number | null; error?: string } | null;
    if (resultError || ex?.error || (ex?.exit && !text)) {
      yield { type: "error", message: resultError || ex?.error || stderr.trim().slice(-800) || `claude exited with ${ex?.exit}` };
      return;
    }
    yield {
      type: "done",
      text: text.trim() || resultText || "",
      sessionId,
      ms: Math.round(performance.now() - started),
    };
  },
};
