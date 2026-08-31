import { Link } from "react-router";
import type { ExploreBoard } from "@/lib/api";

export function ExploreCard({ board, featured }: { board: ExploreBoard; featured?: boolean }) {
  return (
    <Link
      to={`/s/${board.slug}`}
      className={`block rounded-xl border bg-raised px-4 py-3 hover:border-accent/40 ${
        featured ? "border-accent/50 shadow-[0_0_24px_rgba(46,230,200,0.12)]" : "border-border"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted">
        {featured ? "Featured" : "Public"} · {board.ideaCount} idea{board.ideaCount === 1 ? "" : "s"}
      </div>
      <h3 className="mt-1 text-base font-medium text-fg">{board.title}</h3>
      {board.description ? <p className="mt-1 line-clamp-2 text-sm text-muted">{board.description}</p> : null}
      {featured && board.featuredUntil ? (
        <p className="mt-2 text-[11px] text-accent">Until {new Date(board.featuredUntil).toLocaleDateString()}</p>
      ) : (
        <p className="mt-2 font-mono text-[11px] text-muted">{board.slug}</p>
      )}
    </Link>
  );
}
