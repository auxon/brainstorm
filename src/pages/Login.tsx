import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Shell } from "@/components/Header";
import { GoogleIcon } from "@/components/GoogleIcon";
import { useYoursWallet } from "@/lib/wallet-store";
import { refreshSession, useSession, walletSignIn, wrapWalletAuthError } from "@/lib/auth";
import { fetchGoogleStatus, googleStartUrl } from "@/lib/google";
import { YOURS_CHROME, YOURS_SITE } from "@/lib/yours";

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useSession();
  const { status, session, connect } = useYoursWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState<boolean | null>(null);

  useEffect(() => {
    void fetchGoogleStatus()
      .then((s) => setGoogleReady(s.configured))
      .catch(() => setGoogleReady(false));
  }, []);

  useEffect(() => {
    if (params.get("google") === "connected") {
      void refreshSession().then(() => {
        toast.success("Signed in with Google");
        navigate("/", { replace: true });
      });
    }
  }, [params, navigate]);

  async function signInWallet() {
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
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-3 text-muted">
          Use Google to keep boards in your Drive. Yours Wallet is optional and only needed for sat
          boosts from your own keys.
        </p>
        {user?.googleConnected ? (
          <p className="mt-4 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
            Signed in as {user.displayName || user.email || "Google"}
          </p>
        ) : (
          <a
            href={googleStartUrl("/login")}
            className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-bg"
          >
            <GoogleIcon className="size-4" />
            {googleReady === false ? "Continue with Google (setup required)" : "Continue with Google"}
          </a>
        )}
        {googleReady === false ? (
          <p className="mt-2 text-xs text-muted">
            Google OAuth is not configured on this Worker yet. Add{" "}
            <code className="text-fg">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="text-fg">GOOGLE_CLIENT_SECRET</code>, then retry.
          </p>
        ) : null}
        <div className="mt-8 border-t border-border pt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Optional</p>
          <h2 className="mt-2 text-lg font-medium">BSV wallet</h2>
          <button
            type="button"
            disabled={busy || status === "missing"}
            onClick={() => void signInWallet()}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-raised text-sm font-medium text-fg disabled:opacity-50"
          >
            <Wallet className="size-4" strokeWidth={1.8} />
            {busy ? (note ?? "Signing in…") : session ? "Sign signature to continue" : "Connect Yours Wallet"}
          </button>
          {status === "missing" ? (
            <p className="mt-3 text-sm text-muted">
              The Yours Wallet extension is not detected.{" "}
              <a href={YOURS_CHROME} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                Install it in Chrome
              </a>{" "}
              only if you want sat boosts. Learn more at{" "}
              <a href={YOURS_SITE} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                yours.org
              </a>
              .
            </p>
          ) : (
            <ol className="mt-6 space-y-2 text-sm text-muted">
              <li>1. Connect Yours Wallet (unlock the extension if needed)</li>
              <li>2. Approve the sign-in message — no sats leave the wallet</li>
              <li>3. Boost ideas from your own keys; Archive mints still use the site wallet</li>
            </ol>
          )}
        </div>
        <p className="mt-8 text-sm text-muted">
          <Link to="/" className="hover:text-fg">
            Back to Brainstorm
          </Link>
        </p>
      </div>
    </Shell>
  );
}
