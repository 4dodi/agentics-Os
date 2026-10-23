// Minimal Netlify API double for exercising the digest deploy flow locally:
//   NETLIFY_API_URL=http://127.0.0.1:3999/api/v1 npm run dev
import http from "node:http";
import crypto from "node:crypto";

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const blobs = new Map(); // sha -> content
const existing = { "/index.html": "<h1>My real homepage</h1>", "/about/index.html": "<h1>About</h1>" };
for (const c of Object.values(existing)) blobs.set(sha1(c), c);

const deploys = new Map();
deploys.set("dep_live", { id: "dep_live", state: "ready", files: Object.fromEntries(Object.entries(existing).map(([p, c]) => [p, sha1(c)])) });
const sites = new Map([["site-1", { id: "site-1", name: "site-one", url: "http://site-one.netlify.app", ssl_url: "https://site-one.netlify.app", custom_domain: "one.example", published: "dep_live" }]]);
let n = 0;

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/^\/api\/v1/, "");
    let body = Buffer.alloc(0);
    for await (const c of req) body = Buffer.concat([body, c]);
    if (req.headers.authorization !== "Bearer test-token") return send(res, 401, { message: "bad token" });
    let m;
    if (req.method === "GET" && p === "/sites") return send(res, 200, [...sites.values()]);
    if (req.method === "GET" && (m = p.match(/^\/sites\/([^/]+)$/))) {
      const s = sites.get(m[1]);
      return s ? send(res, 200, { ...s, published_deploy: { id: s.published } }) : send(res, 404, { message: "no site" });
    }
    if (req.method === "GET" && (m = p.match(/^\/deploys\/([^/]+)\/files$/))) {
      const d = deploys.get(m[1]);
      return send(res, 200, Object.entries(d.files).map(([id, sha]) => ({ id, sha })));
    }
    if (req.method === "POST" && (m = p.match(/^\/sites\/([^/]+)\/deploys$/))) {
      const { files } = JSON.parse(body.toString());
      const id = `dep_${++n}`;
      const required = [...new Set(Object.values(files).filter((sha) => !blobs.has(sha)))];
      deploys.set(id, { id, state: required.length ? "uploading" : "ready", files, site: m[1], pending: new Set(required) });
      return send(res, 200, { id, state: deploys.get(id).state, required });
    }
    if (req.method === "PUT" && (m = p.match(/^\/deploys\/([^/]+)\/files(\/.*)$/))) {
      const d = deploys.get(m[1]);
      const path = decodeURIComponent(m[2]);
      const sha = sha1(body);
      if (d.files[path] !== sha) return send(res, 422, { message: `sha mismatch for ${path}` });
      blobs.set(sha, body.toString());
      d.pending.delete(sha);
      if (!d.pending.size) {
        d.state = "ready";
        sites.get(d.site).published = d.id;
      }
      return send(res, 200, { id: path, sha });
    }
    if (req.method === "GET" && (m = p.match(/^\/deploys\/([^/]+)$/))) {
      const d = deploys.get(m[1]);
      return send(res, 200, { id: d.id, state: d.state });
    }
    if (req.method === "GET" && p === "/_debug") {
      const s = sites.get("site-1");
      return send(res, 200, { published: s.published, files: deploys.get(s.published).files });
    }
    send(res, 404, { message: `no route ${req.method} ${p}` });
  })
  .listen(3999, "127.0.0.1", () => console.log("mock netlify on :3999"));
