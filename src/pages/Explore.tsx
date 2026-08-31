import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Shell } from "@/components/Header";
import { ExploreCard } from "@/components/ExploreCard";
import { fetchExplore, type ExploreBoard } from "@/lib/api";
import { FEATURE_DAYS, FEATURE_USD } from "@/lib/billing";

export function ExplorePage() {
  const [featured, setFeatured] = useState<ExploreBoard[]>([]);
  const [recent, setRecent] = useState<ExploreBoard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchExplore()
      .then((data) => {
        setFeatured(data.featured);
        setRecent(data.public);
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Could not load boards."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.2em] text-muted">Explore</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Public mind maps worth reading</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Featured boards pay ${FEATURE_USD} to sit here for {FEATURE_DAYS} days. Feature your own board from
        the map toolbar — Checkout makes it public automatically.{" "}
        <Link to="/" className="text-accent hover:underline">
          Create a session
        </Link>
        .
      </p>
      {loading ? <p className="mt-8 text-sm text-muted">Loading boards…</p> : null}
      {featured.length ? (
        <section className="mt-10">
          <h2 className="text-sm uppercase tracking-wider text-muted">Featured</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {featured.map((board) => (
              <ExploreCard key={board.slug} board={board} featured />
            ))}
          </div>
        </section>
      ) : null}
      <section className="mt-10">
        <h2 className="text-sm uppercase tracking-wider text-muted">Recent public boards</h2>
        {recent.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {recent.map((board) => (
              <ExploreCard key={board.slug} board={board} />
            ))}
          </div>
        ) : !loading ? (
          <p className="mt-3 text-sm text-muted">No public boards yet. Create one and turn visibility to public.</p>
        ) : null}
      </section>
    </Shell>
  );
}
