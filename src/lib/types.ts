// Shared types used by both the server (route handlers) and the client (pages).

export type AgentId = "claude" | "hermes" | "openclaw" | "api";
export const AGENT_IDS: AgentId[] = ["claude", "hermes", "openclaw", "api"];

export interface SeoSite {
  id: string;
  name: string;
  domain: string;
  netlifySiteId: string;
  color: string;
  /** Editorial angle that keeps each site's article unique. */
  angle: string;
  blogPath: string;
  enabled: boolean;
}

export interface Settings {
  profile: { name: string; city: string };
  vault: { path: string; profileNotes: string[]; injectByDefault: boolean; maxContextChars: number };
  agents: {
    claude: { enabled: boolean; bin: string; cwd: string; model: string; permissionMode: string; extraArgs: string };
    hermes: {
      enabled: boolean;
      mode: "cli" | "http";
      bin: string;
      chatArgs: string;
      versionArgs: string;
      home: string;
      baseUrl: string;
      apiKey: string;
      model: string;
    };
    openclaw: {
      enabled: boolean;
      mode: "cli" | "http";
      bin: string;
      chatArgs: string;
      versionArgs: string;
      home: string;
      gatewayUrl: string;
      token: string;
      agentId: string;
    };
    api: { enabled: boolean; baseUrl: string; apiKey: string; model: string };
  };
  seo: { engine: AgentId; netlifyToken: string; preserveExisting: boolean; useMemory: boolean; sites: SeoSite[] };
  studio: {
    imageProvider: "hermes" | "claude" | "openclaw" | "api";
    videoProvider: "hermes" | "claude" | "openclaw";
    speechProvider: "hermes" | "claude" | "openclaw" | "api";
    outputDir: string;
    mediaRoots: string[];
    apiBaseUrl: string;
    apiKey: string;
    imageModel: string;
    ttsModel: string;
    ttsVoice: string;
  };
}

export interface AgentStatus {
  id: AgentId;
  name: string;
  enabled: boolean;
  online: boolean;
  version?: string;
  latencyMs?: number;
  model?: string;
  detail?: string;
  meta?: Record<string, string | number>;
  error?: string;
}

export interface StatusResponse {
  ts: number;
  agents: Record<AgentId, AgentStatus>;
  vault: { path: string; ok: boolean; notes: number };
  p50: number | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
  ms?: number;
  error?: boolean;
  tools?: string[];
  memory?: boolean;
}

export interface ChatThread {
  sessionId?: string;
  messages: ChatMessage[];
}

/** NDJSON events streamed from /api/agents/[id]/chat */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "session"; id: string }
  | { type: "done"; text: string; sessionId?: string; ms: number }
  | { type: "error"; message: string };

export interface ActivityItem {
  id: string;
  ts: number;
  kind: "chat" | "seo.generate" | "seo.deploy" | "studio" | "goal" | "journal" | "memory" | "system";
  agent?: AgentId;
  title: string;
  detail?: string;
  ok?: boolean;
  href?: string;
}

export interface Goal {
  id: string;
  title: string;
  why: string;
  kind: "goal" | "automation";
  target: string;
  status: "active" | "done" | "paused";
  progress: number;
  milestones: { id: string; text: string; done: boolean }[];
  createdAt: number;
  updatedAt: number;
}

export interface KanbanCard {
  id: string;
  agent: AgentId;
  text: string;
  column: "todo" | "doing" | "done";
  result?: string;
  error?: boolean;
  createdAt: number;
}

export interface Transcript {
  id: string;
  title: string;
  text: string;
  words: number;
  createdAt: number;
}

export interface SeoArticle {
  siteId: string;
  domain: string;
  color: string;
  status: "pending" | "writing" | "done" | "error";
  chars: number;
  title?: string;
  url?: string;
  words?: number;
  error?: string;
}

export interface SeoSession {
  id: string;
  keyword: string;
  slug: string;
  transcriptLabel: string;
  engine: AgentId;
  startedAt: number;
  ms?: number;
  status: "running" | "done" | "partial" | "error";
  articles: SeoArticle[];
}

export interface SeoPost {
  slug: string;
  title: string;
  description: string;
  keyword: string;
  date: string;
  words: number;
  sessionId?: string;
  deployedAt?: number;
}

export interface SeoDeploy {
  id: string;
  ts: number;
  siteId: string;
  domain: string;
  status: "running" | "ok" | "error";
  ok: boolean;
  ms: number;
  url?: string;
  deployId?: string;
  files?: number;
  uploaded?: number;
  error?: string;
}

export interface StudioItem {
  id: string;
  kind: "image" | "video" | "speech";
  prompt: string;
  provider: string;
  status: "running" | "done" | "error";
  file?: string;
  createdAt: number;
  ms?: number;
  error?: string;
  output?: string;
}

export interface NoteMeta {
  path: string;
  title: string;
  folder: string;
  mtime: number;
  size: number;
}
