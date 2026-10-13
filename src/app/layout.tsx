import type { Metadata, Viewport } from "next";
import Link from "next/link";
import SearchBox from "@/components/SearchBox";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "[placeholder]", template: "%s · [placeholder]" },
  description: "Check a pump.fun launch for bundled buys, linked early wallets, and who is still holding.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5ed" },
    { media: "(prefers-color-scheme: dark)", color: "#171716" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <div className="shell">
          <header className="site-header">
            <Link href="/" className="wordmark">
              <span className="wordmark-mark" aria-hidden />
              [placeholder]
            </Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/smart">Smart wallets</Link>
            </nav>
            <div className="header-search">
              <SearchBox compact />
            </div>
          </header>
          <main className="site-main">{children}</main>
          <footer className="site-footer">
            <div className="footer-cell">
              <span className="mono-label">Data</span>
              <p>Solana mainnet, read on demand when you search.</p>
            </div>
            <div className="footer-cell">
              <span className="mono-label">Read this</span>
              <p>
                Every flag is a heuristic. It shows evidence, not intent. Open the linked transactions before acting on
                anything.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
