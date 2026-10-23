import { NextResponse, type NextRequest } from "next/server";

// Agentic OS can run your agents' CLIs, so the API only answers to this machine's own UI:
// - Host must be a loopback name (blocks DNS-rebinding from other websites)
// - state-changing requests need a same-origin Origin and the x-agentic-os header (blocks CSRF)
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const EXTRA_HOSTS = (process.env.AGENTIC_OS_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);

function hostOk(host: string | null): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "");
  return LOOPBACK.has(name) || EXTRA_HOSTS.includes(name) || EXTRA_HOSTS.includes(host);
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("host");
  if (!hostOk(host)) return new NextResponse("Forbidden host", { status: 403 });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== host) return new NextResponse("Cross-origin request blocked", { status: 403 });
    if (req.headers.get("x-agentic-os") !== "1") return new NextResponse("Missing x-agentic-os header", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
