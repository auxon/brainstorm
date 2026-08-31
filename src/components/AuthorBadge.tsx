import { authorKind, authorKindLabel } from "@/lib/identity";

export function AuthorBadge({ userId, name }: { userId: string; name: string }) {
  const kind = authorKind(userId);
  const label = authorKindLabel(kind);
  const tone =
    kind === "agent"
      ? "border-accent/40 bg-accent/10 text-accent"
      : kind === "human"
        ? "border-border bg-bg text-fg"
        : "border-border bg-bg text-muted";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{name}</span>
      <span className={`rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wide ${tone}`}>{label}</span>
    </span>
  );
}
