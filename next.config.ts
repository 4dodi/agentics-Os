import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  devIndicators: { position: "bottom-right" },
  poweredByHeader: false,
  async headers() {
    // The Content-Security-Policy is set per response in src/proxy.ts, so routes that need a stricter
    // sandbox (article preview, media) can set their own.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
