import { Download } from "lucide-react";
import { apiUrl } from "@/lib/base-path";
import { getBearerToken } from "@/lib/auth";
import { getEditToken } from "@/lib/api";

async function download(slug: string, kind: "md" | "html") {
  const headers = new Headers();
  const bearer = getBearerToken();
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const token = getEditToken(slug) || new URLSearchParams(location.search).get("k");
  if (token) headers.set("X-Token", token);
  const res = await fetch(apiUrl(`/sessions/${slug}/export.${kind}`), { headers, credentials: "include" });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.${kind}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportMenu({ slug }: { slug: string }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => void download(slug, "md")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg"
      >
        <Download className="size-3.5" />
        Markdown
      </button>
      <button
        type="button"
        onClick={() => void download(slug, "html")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-raised px-3 text-xs text-muted hover:text-fg"
      >
        <Download className="size-3.5" />
        HTML
      </button>
    </div>
  );
}
