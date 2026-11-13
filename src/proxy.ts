import { NextResponse, type NextRequest } from "next/server";

// Agentic OS can run your agents' CLIs, so the API only answers to this machine's own UI:
// - Host must be a loopback name (blocks DNS rebinding from other websites)
// - cross-site requests are refused outright, using Sec-Fetch-Site where the browser sends it
//   (blocks <img>/<video>/<script> probes and top-level navigations from other sites, even for GET)
// - state-changing requests need a same-origin Origin and the x-agentic-os header (blocks CSRF)
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const EXTRA_HOSTS = (process.env.AGENTIC_OS_ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

function hostName(host: string): string {
  // "[::1]:3737" → "[::1]", "localhost:3737" → "localhost"
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
}

export function hostOk(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  const name = hostName(h);
  return LOOPBACK.has(name) || EXTRA_HOSTS.includes(name) || EXTRA_HOSTS.includes(h);
}

/** Origin header → host, or null when it is missing; "invalid" for opaque/garbled origins such as "null". */
function originHost(origin: string | null): string | null {
  if (origin === null) return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "invalid";
  }
}

export function checkRequest(req: { method: string; headers: Headers }): string | null {
  const host = req.headers.get("host");
  if (!hostOk(host)) return "Forbidden host";

  // Browsers send this on every request; "none" is a typed URL/bookmark, "same-origin" is our own UI.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Cross-site request blocked";

  const oh = originHost(req.headers.get("origin"));
  if (oh !== null && oh !== host!.toLowerCase()) return "Cross-origin request blocked";

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.headers.get("x-agentic-os") !== "1") return "Missing x-agentic-os header";
  }
  return null;
}

const isDev = process.env.NODE_ENV === "development";

// The UI only ever talks to its own origin. Remote images/media are blocked so content rendered from
// agent replies or vault notes can't leak data to another server, and no other site may frame the app.
export const PAGE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    const res = NextResponse.next();
    res.headers.set("content-security-policy", PAGE_CSP);
    return res;
  }
  const problem = checkRequest(req);
  if (problem) return new NextResponse(problem, { status: 403, headers: { "cache-control": "no-store" } });
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
