"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Turn Obsidian [[wikilinks]] into links with a `#note:` href the caller can intercept. */
export function wikilinksToMarkdown(md: string, embedUrl?: (name: string) => string): string {
  return md
    .replace(/!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp|svg))(?:\|[^\]]*)?\]\]/gi, (_m, name: string) =>
      embedUrl ? `![${name}](${embedUrl(name)})` : name,
    )
    .replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, _h, alias?: string) =>
      `[${(alias || target).trim()}](#note:${encodeURIComponent(target.trim())})`,
    );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "external";
  }
}

export function Markdown({ children, onWikiLink }: { children: string; onWikiLink?: (target: string) => void }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          a: ({ node: _n, href, ...props }) => {
            if (href?.startsWith("#note:")) {
              const target = decodeURIComponent(href.slice(6));
              return (
                <a
                  {...props}
                  href="#"
                  className="wikilink"
                  onClick={(e) => {
                    e.preventDefault();
                    onWikiLink?.(target);
                  }}
                />
              );
            }
            const safe = href && /^(https?:|mailto:|\/|#)/i.test(href) ? href : undefined;
            return <a {...props} href={safe} target="_blank" rel="noopener noreferrer" />;
          },
          // Only same-origin images load inline. Remote images become links, so a reply can't
          // exfiltrate memory or chat content through an image URL just by being rendered.
          img: ({ node: _n, src, alt, ...props }) => {
            const url = typeof src === "string" ? src : "";
            if (/^(\/api\/media\/|data:image\/(png|jpe?g|gif|webp);)/i.test(url)) return <img {...props} src={url} alt={alt || ""} />;
            const link = /^https?:/i.test(url) ? url : undefined;
            return (
              <a href={link} target="_blank" rel="noopener noreferrer" className="ext-image">
                🖼 {alt || "image"}{link ? ` (${hostOf(link)})` : ""}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
