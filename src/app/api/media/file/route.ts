import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getSettings } from "@/lib/settings";
import { ALL_MEDIA_EXT, mediaRoots } from "@/lib/studio";
import { expandHome } from "@/lib/store";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/opus",
  pdf: "application/pdf",
};

/**
 * Serves local media files (with Range support for video seeking).
 * Only media extensions, and only from the data dir, vault, Studio output and configured media roots.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const raw = u.searchParams.get("path");
  if (!raw || raw.includes("\0")) return new Response("path is required", { status: 400 });
  const extOf = (p: string) => (path.extname(p).slice(1) || "").toLowerCase();
  if (!ALL_MEDIA_EXT.has(extOf(raw))) return new Response("not a media file", { status: 403 });

  let real: string;
  try {
    real = await fs.realpath(path.resolve(expandHome(raw)));
  } catch {
    return new Response("not found", { status: 404 });
  }
  // Check the extension of what the path really points to, so a "photo.png" symlink can't serve a non-media file.
  const ext = extOf(real);
  if (!ALL_MEDIA_EXT.has(ext)) return new Response("not a media file", { status: 403 });
  const s = await getSettings();
  const roots = await Promise.all(mediaRoots(s).map((r) => fs.realpath(r).catch(() => r)));
  if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) {
    return new Response("outside allowed media folders (Settings → Studio → media roots)", { status: 403 });
  }
  const st = await fs.stat(real);
  if (!st.isFile()) return new Response("not found", { status: 404 });
  const headers: Record<string, string> = {
    "content-type": MIME[ext] || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  // SVG and PDF can carry script: render them in an opaque, script-less sandbox, never as our origin.
  if (ext === "svg" || ext === "pdf") headers["content-security-policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  if (u.searchParams.get("download")) {
    const name = path.basename(real);
    const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
    headers["content-disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    const stream = Readable.toWeb(createReadStream(real, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(real)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "content-length": String(st.size) } });
}
