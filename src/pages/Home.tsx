import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Shell } from "@/components/Header";
import { ExploreCard } from "@/components/ExploreCard";
import { apiFetch, fetchExplore, listRecent, rememberSession, saveEditToken, type ExploreBoard, type PublicSession } from "@/lib/api";
import { refreshSession, useSession } from "@/lib/auth";
import { FEATURE_DAYS, FEATURE_USD } from "@/lib/billing";
import { fetchGoogleStatus, googleStartUrl, importDriveFile, listDriveFiles, type DriveFileCard } from "@/lib/google";

export function HomePage() {
  const { user, isPending } = useSession();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [featured, setFeatured] = useState<ExploreBoard[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFileCard[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const recent = listRecent();

  useEffect(() => {
    void fetchExplore()
      .then((data) => setFeatured(data.featured))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") {
      void refreshSession().then(() => {
        toast.success("Signed in with Google. Boards can save to Drive.");
        params.delete("google");
        const next = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
      });
    }
  }, []);

  useEffect(() => {
    void fetchGoogleStatus()
      .then((status) => {
        setGoogleConnected(status.connected);
        if (status.connected) {
          return listDriveFiles().then(setDriveFiles);
        }
        return undefined;
      })
      .catch(() => undefined);
  }, [user?.id, user?.googleConnected]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const created = await apiFetch<{
        session: PublicSession;
        editToken: string;
        token?: string | null;
      }>("/sessions", { method: "POST", body: JSON.stringify({ title: title.trim(), description }) });
      saveEditToken(created.session.slug, created.editToken);
      rememberSession(created.session.slug, created.session.title);
      await refreshSession();
      navigate(`/s/${created.session.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-xl">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">EntangleIT</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Post ideas. Map them. Share the session.</h1>
        <p className="mt-3 text-muted">
          No wallet required. Create a board, nest ideas, upvote, and export Markdown or HTML.
          {" "}
          <Link to="/billing" className="text-accent hover:underline">
            Archive ($9/mo)
          </Link>{" "}
          inscribes a board as a 1Sat Ordinal NFT.{" "}
          <Link to="/explore" className="text-accent hover:underline">
            Feature a board (${FEATURE_USD}/{FEATURE_DAYS}d)
          </Link>{" "}
          or boost ideas $1–$5 with Stripe. Agents can use the same API over MCP at{" "}
          <a href="https://entangleit.com/brainstorm/mcp" className="text-accent hover:underline">
            /brainstorm/mcp
          </a>
          .
        </p>
        <form onSubmit={(e) => void create(e)} className="mt-8 space-y-3 rounded-2xl border border-border bg-raised p-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Session title"
            className="h-11 w-full rounded-lg border border-border bg-bg px-3 text-fg outline-none focus:border-accent"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this brainstorm about? (optional)"
            rows={3}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || isPending}
            className="h-11 w-full rounded-lg bg-accent text-sm font-medium text-bg disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create session"}
          </button>
        </form>
        {!user?.googleConnected ? (
          <p className="mt-3 text-xs text-muted">
            <a href={googleStartUrl("/")} className="text-accent hover:underline">
              Sign in with Google
            </a>{" "}
            to save mind maps to Drive. A BSV wallet is only needed for sat boosts.
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted">
            Signed in as {user.displayName || user.email}. New boards you create can be saved to a{" "}
            <span className="text-fg">Brainstorm</span> folder on Google Drive.
          </p>
        )}
        {featured.length ? (
          <section className="mt-10">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm uppercase tracking-wider text-muted">Featured</h2>
              <Link to="/explore" className="text-xs text-accent hover:underline">
                See all
              </Link>
            </div>
            <div className="mt-3 space-y-2">
              {featured.slice(0, 3).map((board) => (
                <ExploreCard key={board.slug} board={board} featured />
              ))}
            </div>
          </section>
        ) : null}
        {googleConnected && driveFiles.length ? (
          <section className="mt-10">
            <h2 className="text-sm uppercase tracking-wider text-muted">On Google Drive</h2>
            <ul className="mt-3 space-y-2">
              {driveFiles.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void importDriveFile(file.id)
                        .then((imported) => {
                          saveEditToken(imported.session.slug, imported.editToken);
                          rememberSession(imported.session.slug, imported.session.title);
                          navigate(`/s/${imported.session.slug}`);
                        })
                        .catch((err) => toast.error(err instanceof Error ? err.message : "Could not open Drive file"));
                    }}
                    className="block w-full rounded-lg border border-border bg-raised px-4 py-3 text-left hover:border-accent/40"
                  >
                    {file.name.replace(/\.brainstorm\.json$/i, "")}
                    <span className="ml-2 font-mono text-xs text-muted">Drive</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {recent.length ? (
          <section className="mt-10">
            <h2 className="text-sm uppercase tracking-wider text-muted">On this device</h2>
            <ul className="mt-3 space-y-2">
              {recent.map((r) => (
                <li key={r.slug}>
                  <Link
                    to={`/s/${r.slug}`}
                    className="block rounded-lg border border-border bg-raised px-4 py-3 hover:border-accent/40"
                  >
                    {r.title}
                    <span className="ml-2 font-mono text-xs text-muted">{r.slug}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
