import { Link } from "react-router";
import { WalletButton } from "./WalletButton";
import { BASE_PATH } from "@/lib/base-path";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-fg">Brainstorm</span>
          <span className="hidden text-[11px] uppercase tracking-[0.18em] text-muted sm:inline">
            EntangleIT
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/explore" className="hidden text-xs text-muted hover:text-fg sm:inline">
            Explore
          </Link>
          <Link to="/billing" className="hidden text-xs text-muted hover:text-fg sm:inline">
            Archive
          </Link>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        Brainstorm · {BASE_PATH} · Featured $29/7d · Archive NFTs minted by the site wallet
      </footer>
    </div>
  );
}
