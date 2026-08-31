import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Shell } from "@/components/Header";
import { useYoursWallet } from "@/lib/wallet-store";
import { refreshSession, walletSignIn, wrapWalletAuthError } from "@/lib/auth";
import { YOURS_CHROME, YOURS_SITE } from "@/lib/yours";

export function LoginPage() {
  const navigate = useNavigate();
  const { status, session, connect } = useYoursWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setNote(null);
    try {
      if (!session) await connect();
      const next = useYoursWallet.getState().session;
      setNote("Approve the signature in Yours Wallet…");
      await walletSignIn(next?.identity ?? null, next?.addresses.bsvAddress ?? null);
      await refreshSession();
      toast.success("Signed in with Yours Wallet");
      navigate("/");
    } catch (err) {
      toast.error(wrapWalletAuthError(err).message);
    } finally {
      setNote(null);
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Account</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in with Yours Wallet</h1>
        <p className="mt-3 text-muted">
          Brainstorm binds your ideas, comments, and upvotes to your BSV identity — no email or
          password. Connect the extension, then approve a sign-in message (no transaction, no fee).
        </p>
        <button
          type="button"
          disabled={busy || status === "missing"}
          onClick={() => void signIn()}
          className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-bg disabled:opacity-50"
        >
          <Wallet className="size-4" strokeWidth={1.8} />
          {busy ? (note ?? "Signing in…") : session ? "Sign signature to continue" : "Sign in with Yours Wallet"}
        </button>
        {status === "missing" ? (
          <p className="mt-3 text-sm text-muted">
            The Yours Wallet extension is not detected.{" "}
            <a href={YOURS_CHROME} className="text-accent hover:underline" target="_blank" rel="noreferrer">
              Install it in Chrome
            </a>
            , then reload. Learn more at{" "}
            <a href={YOURS_SITE} className="text-accent hover:underline" target="_blank" rel="noreferrer">
              yours.org
            </a>
            .
          </p>
        ) : (
          <ol className="mt-6 space-y-2 text-sm text-muted">
            <li>1. Connect Yours Wallet (unlock the extension if needed)</li>
            <li>2. Approve the sign-in message — no sats leave the wallet</li>
            <li>3. Upvote ideas, boost with sats, and share mind maps</li>
          </ol>
        )}
        <p className="mt-8 text-sm text-muted">
          <Link to="/" className="hover:text-fg">
            Back to Brainstorm
          </Link>
        </p>
      </div>
    </Shell>
  );
}
