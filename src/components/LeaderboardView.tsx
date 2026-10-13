"use client";

import Link from "next/link";
import Addr from "./Addr";
import Loading from "./Loading";
import SectionHead from "./SectionHead";
import TraderBadge from "./TraderBadge";
import { useApi } from "./useApi";
import { fmtAgo, fmtDuration, fmtPct, fmtSol, short } from "@/lib/format";
import { SMART_RULES } from "@/lib/smart";
import type { Leaderboard } from "@/lib/types";

export default function LeaderboardView() {
  const state = useApi<Leaderboard>("/api/leaderboard");
  if (state.status === "loading") return <Loading title="Loading leaderboard" steps={["Read tracked wallets", "Read repeat funders"]} />;
  if (state.status === "error") {
    return (
      <section className="empty" role="alert">
        <span className="mono-label">[{state.code || "ERR"}]</span>
        <h1>{state.error}</h1>
      </section>
    );
  }
  const d = state.data;
  return (
    <article className="wallet">
      <header className="page-head">
        <h1>Smart wallets</h1>
        <p className="muted">
          Built from every token and wallet looked up here. Wallets land on this board when their recent trades show at
          least {SMART_RULES.minClosed} closed positions with a profit. Smart also needs a {Math.round(SMART_RULES.minWinRate * 100)}%+
          win rate, {SMART_RULES.minPnlSol}+ SOL realized and a median hold of {fmtDuration(SMART_RULES.convictionHoldSec)} or more.
        </p>
        {!d.persistent && (
          <p className="mono-label warn">
            Not persistent: connect Upstash Redis so this board survives restarts and is shared across servers.
          </p>
        )}
      </header>

      <section className="sec" aria-labelledby="lb-smart-h">
        <SectionHead n={1} id="lb-smart-h" title="Profitable wallets" aside={<span className="mono-label muted">{d.smart.length} tracked</span>} />
        {d.smart.length === 0 ? (
          <p className="muted">None yet. Look up a few tokens and the early buyers get rated automatically.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Wallet</th>
                  <th scope="col">Rating</th>
                  <th scope="col" className="num">Win rate</th>
                  <th scope="col" className="num">Realized</th>
                  <th scope="col" className="num">Median hold</th>
                  <th scope="col" className="num">Closed</th>
                  <th scope="col">Seen early in</th>
                  <th scope="col" className="num">Updated</th>
                </tr>
              </thead>
              <tbody>
                {d.smart.map((x, i) => (
                  <tr key={x.wallet} className={x.rating.label === "smart" ? "row-smart" : "row-flipper"}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <Addr address={x.wallet} href={`/wallet/${x.wallet}`} />
                    </td>
                    <td>
                      <TraderBadge rating={x.rating} />
                    </td>
                    <td className="num">{x.stats.winRate === null ? "–" : fmtPct(x.stats.winRate * 100)}</td>
                    <td className="num pos">{fmtSol(x.stats.realizedPnlSol, true)}</td>
                    <td className="num">{fmtDuration(x.stats.medianHoldSec)}</td>
                    <td className="num">{x.stats.closedPositions}</td>
                    <td>
                      {x.mints.length === 0 ? (
                        <span className="muted">–</span>
                      ) : (
                        x.mints.slice(0, 3).map((m) => (
                          <Link key={m} href={`/token/${m}`} className="chip">
                            {short(m)}
                          </Link>
                        ))
                      )}
                      {x.mints.length > 3 && <span className="muted"> +{x.mints.length - 3}</span>}
                    </td>
                    <td className="num muted">{fmtAgo(x.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sec" aria-labelledby="lb-funders-h">
        <SectionHead
          n={2}
          id="lb-funders-h"
          title="Repeat funders"
          note="Addresses that sent SOL to early buyers in two or more launches looked up here. This is the pattern serial bundlers leave."
          aside={<span className="mono-label muted">{d.funders.length} tracked</span>}
        />
        {d.funders.length === 0 ? (
          <p className="muted">No address has funded early buyers in more than one tracked launch yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Funder</th>
                  <th scope="col" className="num">Launches</th>
                  <th scope="col" className="num">Wallets funded</th>
                  <th scope="col">Launches</th>
                  <th scope="col" className="num">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {d.funders.map((f) => (
                  <tr key={f.address}>
                    <td>
                      <Addr address={f.address} href={`/wallet/${f.address}`} />
                      {f.label && <span className="tag">{f.label}</span>}
                    </td>
                    <td className="num neg">{f.launches.length}</td>
                    <td className="num">{f.walletsFunded}</td>
                    <td>
                      {f.launches.slice(0, 4).map((l) => (
                        <Link key={l.mint} href={`/token/${l.mint}`} className="chip">
                          {short(l.mint)}
                        </Link>
                      ))}
                      {f.launches.length > 4 && <span className="muted"> +{f.launches.length - 4}</span>}
                    </td>
                    <td className="num muted">{fmtAgo(f.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
