import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Build Guide" };

function Code({ children }: { children: string }) {
  return (
    <pre className="console console-out" style={{ minHeight: 0 }}>
      {children}
    </pre>
  );
}

export default function GuidePage() {
  return (
    <div className="guide">
      <PageHeader title="Build Guide" subtitle="Get every agent online, give them memory, then add one automation a week." />

      <div className="grid cols-2">
        <div className="card">
          <h2>1 · Run Agentic OS</h2>
          <Code>{`npm install
npm run dev        # http://localhost:3737`}</Code>
          <p className="muted">
            Everything is stored locally in <code>./data</code>. The server only listens on 127.0.0.1 and the API rejects
            requests from other websites, because it can drive your agents.
          </p>
        </div>
        <div className="card">
          <h2>2 · Claude Code</h2>
          <Code>{`npm install -g @anthropic-ai/claude-code
claude            # log in once with your subscription`}</Code>
          <p className="muted">
            Agentic OS runs <code>claude -p --output-format stream-json</code> and resumes the same session per chat. Pick a
            working directory and permission mode in <Link href="/settings#agents"><u>Settings</u></Link>.
          </p>
        </div>
        <div className="card">
          <h2>3 · Hermes</h2>
          <Code>{`# install (see the Hermes Agent README for the current one-liner)
hermes setup       # pick a model/provider, e.g. Grok or a free OpenRouter model
hermes chat -q "hello"`}</Code>
          <p className="muted">
            CLI mode runs <code>hermes chat -q {"{prompt}"}</code>; adjust the template if your version differs. Or point HTTP
            mode at its OpenAI-compatible API server. Skills in <code>~/.hermes/skills</code> show up in the Control Room.
          </p>
        </div>
        <div className="card">
          <h2>4 · OpenClaw</h2>
          <Code>{`npm install -g openclaw
openclaw onboard   # starts the gateway on :18789`}</Code>
          <p className="muted">
            Status checks the gateway; chat uses <code>openclaw agent --agent main --message …</code> or the gateway&apos;s
            chat-completions endpoint in HTTP mode.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>The part almost nobody sets up: memory</h2>
        <p className="muted">
          Point <Link href="/settings#memory"><u>Settings → Memory</u></Link> at your Obsidian vault and pin an <strong>About Me</strong> note: who
          you are, what you do, your audience, tone, tools and current projects. Every chat, article, plan and reflection then gets that
          profile plus the notes most relevant to the request. Your journal lands in the same vault, so agents learn from what you did
          yesterday. Use <Link href="/memory"><u>Memory → What agents see</u></Link> to check exactly what gets sent.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Keep the vault simple. Ask an agent to organise it for you (“clean up my vault into folders any agent can understand”), rather
          than adding plugins.
        </p>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>First-day workflow</h2>
        <div className="steps">
          <div className="step"><div><strong>Give context.</strong> <span className="muted">Fill in your About Me note and journal for a few days.</span></div></div>
          <div className="step"><div><strong>Ask for one automation.</strong> <span className="muted">“Based on what you know about me, what&apos;s the best automation I could set up today?”</span></div></div>
          <div className="step"><div><strong>Track it.</strong> <span className="muted">Add it on <Link href="/goals"><u>Goals</u></Link> as a weekly automation and use “Plan with agent”.</span></div></div>
          <div className="step"><div><strong>Implement, test, refine.</strong> <span className="muted">Hand tasks to agents from the Control Room kanban.</span></div></div>
          <div className="step"><div><strong>Next week, add one more.</strong> <span className="muted">One personalised automation per week compounds.</span></div></div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>SEO pipeline → Netlify</h2>
          <div className="steps">
            <div className="step"><div className="muted">Create a Netlify personal access token and add your sites (domain + Netlify site id + an editorial angle each) in <Link href="/settings#seo"><u>Settings → SEO</u></Link>.</div></div>
            <div className="step"><div className="muted">Save case studies or video transcripts under <strong>Transcripts</strong>.</div></div>
            <div className="step"><div className="muted"><strong>Generate</strong>: keyword + transcript → one unique article per site, written with your SKILL.md and memory.</div></div>
            <div className="step"><div className="muted">Preview, then <strong>Deploy</strong>. Existing files on each site are kept; only <code>/blog/</code> changes.</div></div>
          </div>
        </div>
        <div className="card">
          <h2>Studio & video skills</h2>
          <p className="muted">
            Studio asks your agent to use its own image / video / TTS tools, save into the Studio folder and reply with the path. Install
            video skills such as <strong>Hyperframes</strong> or <strong>Remotion</strong> into Hermes or Claude by pasting their GitHub
            README into a chat and asking the agent to set it up, then ask: “edit /full/path/to/video.mp4 with hyperframes — cut the
            silences and add captions”. Be specific with file paths.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Replacing an n8n workflow? Screenshot it, paste the description into a chat and ask the agent to rebuild it without n8n.
          </p>
        </div>
      </div>
    </div>
  );
}
