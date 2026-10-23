"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { api } from "@/lib/client";
import { Spinner, useToast } from "@/components/ui";

export function SkillTab() {
  const toast = useToast();
  const [content, setContent] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api<{ content: string; isDefault: boolean }>("/api/seo/skill").then((r) => {
      setContent(r.content);
      setIsDefault(r.isDefault);
    });
  }, []);
  if (content === null) return <Spinner />;
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <h3>SKILL.md — article writer</h3>
          <div className="muted" style={{ fontSize: 13 }}>
            Sent as the system prompt for every article, together with your memory. {isDefault ? "Using the built-in default." : "Customised."}
          </div>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              if (!confirm("Reset the skill to the built-in default?")) return;
              const r = await api<{ content: string }>("/api/seo/skill", { method: "DELETE" });
              setContent(r.content);
              setIsDefault(true);
              setDirty(false);
            }}
          >
            <RotateCcw size={15} /> Reset
          </button>
          <button
            className="btn primary"
            disabled={!dirty}
            onClick={async () => {
              await api("/api/seo/skill", { method: "PUT", json: { content } });
              setDirty(false);
              setIsDefault(false);
              toast("Skill saved");
            }}
          >
            <Save size={15} /> Save
          </button>
        </div>
      </div>
      <textarea
        className="textarea mono"
        style={{ minHeight: 520, fontSize: 13.5 }}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
      />
    </div>
  );
}
