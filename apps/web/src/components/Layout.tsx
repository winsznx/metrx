import type {ReactNode} from "react";
import {Link, NavLink, useLocation} from "react-router-dom";
import {CORE_ADDRESS, GITHUB_URL} from "@/lib/config";
import {explorerAddress} from "@metrx/shared";
import {ConnectButton} from "./Wallet";

const NAV = [
  {to: "/app", label: "Product"},
  {to: "/proof", label: "Proof"},
  {to: "/docs/security", label: "Security"},
  {to: "/docs/what-is-real", label: "What is real"},
];

export function Header() {
  const {pathname} = useLocation();
  const inApp = pathname.startsWith("/app");

  return (
    <header className="sticky top-0 z-30 border-b border-ink/8 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between gap-6 px-6">
        <Link to="/" className="flex items-center gap-2 text-[17px] font-medium tracking-[-0.02em]">
          <span className="text-bot">✶</span> Metrx
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({isActive}) =>
                `text-sm transition-colors ${isActive ? "text-ink" : "text-slate hover:text-ink"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {inApp ? (
            <ConnectButton size="sm" />
          ) : (
            <Link to="/app" className="btn btn-primary">
              Launch app
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="hairline-t mt-24 bg-paper">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-2 text-[17px] font-medium tracking-[-0.02em]">
            <span className="text-bot">✶</span> Metrx
          </p>
          <p className="mt-2 max-w-xs text-sm text-slate">AI-native compute settlement on BOT Chain Mainnet.</p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            {label: "Launch app", to: "/app"},
            {label: "Proof", to: "/proof"},
            {label: "Security", to: "/docs/security"},
            {label: "What is real", to: "/docs/what-is-real"},
            {label: "Get started", to: "/app/onboarding"},
          ]}
        />
        <FooterColumn
          title="Build"
          links={[
            ...(GITHUB_URL ? [{label: "GitHub", href: GITHUB_URL}] : []),
            {
              label: "Contract",
              href: CORE_ADDRESS ? explorerAddress(CORE_ADDRESS) : "https://scan.botchain.ai",
            },
            ...(GITHUB_URL ? [{label: "Claim ledger", href: `${GITHUB_URL}/blob/main/CLAIM_LEDGER.md`}] : []),
            {label: "Architecture", to: "/docs/architecture"},
          ]}
        />
        <FooterColumn
          title="Network"
          links={[
            {label: "BOT Chain Mainnet", href: "https://scan.botchain.ai"},
            {label: "BOTScan", href: "https://scan.botchain.ai"},
          ]}
        />
      </div>
      <div className="mx-auto max-w-[1180px] border-t border-ink/8 px-6 py-5 text-xs text-stone">
        Chain 677 · native BOT escrow · AI-signed verdicts. v1 proves publicly auditable AI adjudication for bounded
        compute jobs. It does not claim generalized trustless compute.
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: {label: string; to?: string; href?: string}[];
}) {
  return (
    <div>
      <p className="eyebrow">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.to ? (
              <Link className="text-sm text-slate hover:text-ink" to={l.to}>
                {l.label}
              </Link>
            ) : (
              <a className="text-sm text-slate hover:text-ink" href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Page({children}: {children: ReactNode}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
