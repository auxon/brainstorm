import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Shell } from "@/components/Header";
import { apiFetch, listRecent, rememberSession, saveEditToken, type PublicSession } from "@/lib/api";
import { refreshSession, useSession } from "@/lib/auth";

export function HomePage() {
  const { user, isPending } = useSession();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const recent = listRecent();

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
          inscribes a board as a 1Sat Ordinal NFT from the Brainstorm site wallet.
          Agents can use the same API over MCP at{" "}
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
        {user?.isGuest ? (
          <p className="mt-3 text-xs text-muted">
            You are browsing as Guest.{" "}
            <Link to="/login" className="text-accent hover:underline">
              Optional BSV wallet
            </Link>{" "}
            is only for sat boosts.
          </p>
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
