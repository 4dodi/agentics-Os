// OMI + Google (OAuth token + Search Console) API doubles on :3998, for trying the integrations locally:
//   OMI_API_URL=http://127.0.0.1:3998 GSC_TOKEN_URL=http://127.0.0.1:3998/token \
//   GSC_API_URL=http://127.0.0.1:3998/webmasters/v3 npm run dev
// OMI key: omi_dev_test. Any service-account JSON with client_email + a real RSA private_key works.
import http from "node:http";

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString();
const conversations = [
  {
    id: "conv_1",
    started_at: day(1),
    finished_at: day(1),
    structured: { title: "Planning the SEO network", overview: "Talked through which keywords to target next and the weekly publishing rhythm.", emoji: "📈", category: "business", action_items: [{ description: "Draft 3 keyword ideas", completed: false }] },
    transcript_segments: [{ text: "Let's do one article per site per week.", speaker_name: "Me", is_user: true }, { text: "And track clicks in Search Console.", speaker_name: "Sam" }],
  },
  {
    id: "conv_2",
    started_at: day(0),
    finished_at: day(0),
    structured: { title: "Gym and recovery", overview: "Recovery plan for the week.", emoji: "💪", category: "health", action_items: [] },
  },
];

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const c of req) body += c;

    if (url.pathname === "/v1/dev/user/conversations" && req.method === "GET") {
      if (req.headers.authorization !== "Bearer omi_dev_test") return send(res, 401, { detail: "Invalid API key" });
      const start = url.searchParams.get("start_date");
      const off = Number(url.searchParams.get("offset") || 0);
      const lim = Number(url.searchParams.get("limit") || 25);
      const withT = url.searchParams.get("include_transcript") === "true";
      const list = conversations
        .filter((c) => !start || c.started_at >= start)
        .map((c) => (withT ? c : { ...c, transcript_segments: undefined }));
      return send(res, 200, list.slice(off, off + lim));
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || (p.get("assertion") || "").split(".").length !== 3)
        return send(res, 400, { error: "invalid_grant" });
      return send(res, 200, { access_token: "ya29.mock", expires_in: 3600, token_type: "Bearer" });
    }

    const m = url.pathname.match(/^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/);
    if (m && req.method === "POST") {
      if (req.headers.authorization !== "Bearer ya29.mock") return send(res, 401, { error: { message: "unauthenticated" } });
      const property = decodeURIComponent(m[1]);
      if (property.includes("forbidden")) return send(res, 403, { error: { message: "User does not have sufficient permission for site" } });
      const q = JSON.parse(body || "{}");
      const rows = [];
      let seed = [...property].reduce((a, c) => a + c.charCodeAt(0), 0);
      let i = -1;
      for (let d = new Date(`${q.startDate}T00:00:00Z`); d.toISOString().slice(0, 10) <= q.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        seed = (seed * 9301 + 49297) % 233280;
        i++;
        if (i % 9 === 4) continue; // a gap: no data that day
        const clicks = Math.round(20 + i * 1.6 + (seed / 233280) * 18);
        rows.push({ keys: [d.toISOString().slice(0, 10)], clicks, impressions: clicks * 31, ctr: 0.03, position: 12.4 });
      }
      return send(res, 200, { rows, responseAggregationType: "byProperty" });
    }
    send(res, 404, { error: "not found" });
  })
  .listen(3998, "127.0.0.1", () => console.log("mock OMI + Google on :3998"));
