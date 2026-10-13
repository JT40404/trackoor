"use client";

import Link from "next/link";
import Addr from "./Addr";
import Loading from "./Loading";
import SectionHead from "./SectionHead";
import TraderBadge from "./TraderBadge";
import { classifyTrader, TRADER_LABELS } from "@/lib/smart";
import { useApi } from "./useApi";
import { fmtAgo, fmtDate, fmtDuration, fmtPct, fmtSol, short } from "@/lib/format";
import type { FundingEdge, PositionStatus, WalletProfile } from "@/lib/types";

const STATUS: Record<PositionStatus, string> = {
  holding: "Holding",
  partial: "Sold some",
  exited: "Sold all",
  transferred: "Moved out",
  unknown: "Unknown",
};

const VENUE = { pump: "pump.fun", other: "DEX", mixed: "Both" } as const;

export default function WalletView({ address }: { address: string }) {
  const state = useApi<WalletProfile>(`/api/wallet/${address}`);

  if (state.status === "loading") {
    return (
      <Loading
        title="Reading wallet"
        steps={[`Fetch recent transactions for ${short(address)}`, "Separate trades from transfers", "Match buys to sells", "Total up results"]}
      />
    );
  }
  if (state.status === "error") {
    return (
      <section className="empty" role="alert">
        <span className="mono-label">[{state.code || "ERR"}]</span>
        <h1>{state.error}</h1>
        {state.hint && <p>{state.hint}</p>}
      </section>
    );
  }

  const p = state.data;
  const s = p.stats;
  const rating = classifyTrader({
    closedPositions: s.closedPositions,
    tokensTraded: s.tokensTraded,
    winRate: s.winRate,
    realizedPnlSol: s.realizedPnlSol,
    medianHoldSec: s.medianHoldSec,
    avgBuySol: s.avgBuySol,
    txsScanned: p.txsScanned,
  });
  return (
    <article className="wallet">
      <header className="token-head">
        <div className="token-id">
          <div>
            <h1>Wallet {short(address, 5)}</h1>
          </div>
        </div>
        <dl className="token-meta">
          <div>
            <dt className="mono-label">Address</dt>
            <dd>
              <Addr address={address} full />
            </dd>
          </div>
          <div>
            <dt className="mono-label">First transaction</dt>
            <dd>{p.firstSeen ? `${fmtDate(p.firstSeen)} (${fmtAgo(p.firstSeen)})` : "Unknown"}</dd>
          </div>
        </dl>
      </header>

      <section className={`verdict verdict-trader-${rating.label}`}>
        <span className="verdict-mark" aria-hidden />
        <div>
          <p className="verdict-text">
            {TRADER_LABELS[rating.label]}
            {rating.score !== null && <span className="verdict-score"> {rating.score}/100</span>}
          </p>
          <p className="verdict-sub muted">{rating.reasons.join(". ")}.</p>
        </div>
        <TraderBadge rating={rating} showScore={false} />
      </section>

      <section className="sec" aria-labelledby="summary-h">
      <SectionHead n={1} id="summary-h" title="Track record" />
      <dl className="stats">
        <div>
          <dt>Realized</dt>
          <dd className={s.realizedPnlSol > 0 ? "pos" : s.realizedPnlSol < 0 ? "neg" : undefined}>
            {fmtSol(s.realizedPnlSol, true)} SOL
          </dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{s.winRate === null ? "–" : fmtPct(s.winRate * 100)}</dd>
        </div>
        <div>
          <dt>Median hold</dt>
          <dd>{fmtDuration(s.medianHoldSec)}</dd>
        </div>
        <div>
          <dt>Tokens traded</dt>
          <dd>
            {s.tokensTraded} <span className="muted">({s.closedPositions} closed)</span>
          </dd>
        </div>
        <div>
          <dt>Average buy</dt>
          <dd>{s.avgBuySol === null ? "–" : `${fmtSol(s.avgBuySol)} SOL`}</dd>
        </div>
        <div>
          <dt>Trades on pump.fun</dt>
          <dd>{s.pumpShare === null ? "–" : fmtPct(s.pumpShare * 100)}</dd>
        </div>
      </dl>
      <p className="fineprint mono-label">
        Win rate, realized and median hold use closed positions only: tokens fully sold where every sell matched a buy
        in the scanned history.
        {p.truncated && ` Based on the most recent ${p.txsScanned} transactions; older activity isn't included.`}
      </p>
      </section>

      <section className="sec" aria-labelledby="funding-h">
        <SectionHead
          n={2}
          id="funding-h"
          title="Funding"
          note="SOL transfers of 0.01 or more in the scanned history. Swaps and fees paid through programs aren't included."
        />
        <div className="split split-flat">
          <EdgeList title="Received SOL from" edges={p.funding.sources} />
          <EdgeList title="Sent SOL to" edges={p.funding.recipients} />
        </div>
        {p.fundedLaunches.length > 0 && (
          <div className="repeat-box">
            <span className="mono-label neg">
              Funded early buyers in {p.fundedLaunches.length} launch{p.fundedLaunches.length > 1 ? "es" : ""}
            </span>
            <p>
              {p.fundedLaunches.map((l, i) => (
                <span key={l.mint}>
                  {i > 0 && ", "}
                  <Link href={`/token/${l.mint}`}>{short(l.mint)}</Link> <span className="muted">({l.wallets} wallets)</span>
                </span>
              ))}
            </p>
          </div>
        )}
      </section>

      <section className="sec" aria-labelledby="positions-h">
        <SectionHead n={3} id="positions-h" title="Positions" />
        {p.tokens.length === 0 ? (
          <p className="muted">No token trades found in the scanned history.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Venue</th>
                  <th scope="col" className="num">SOL in</th>
                  <th scope="col" className="num">SOL out</th>
                  <th scope="col" className="num">Realized</th>
                  <th scope="col">Now</th>
                  <th scope="col" className="num">Held for</th>
                  <th scope="col" className="num">Last trade</th>
                </tr>
              </thead>
              <tbody>
                {p.tokens.map((t) => (
                  <tr key={t.mint}>
                    <td>
                      <Link href={`/token/${t.mint}`} className="addr-text" title={t.mint}>
                        {short(t.mint)}
                      </Link>
                    </td>
                    <td className="muted">{VENUE[t.venue]}</td>
                    <td className="num">{fmtSol(t.solIn)}</td>
                    <td className="num">{fmtSol(t.solOut)}</td>
                    <td className="num">
                      <span className={t.realizedPnlSol > 0 ? "pos" : t.realizedPnlSol < 0 ? "neg" : undefined}>
                        {fmtSol(t.realizedPnlSol, true)}
                      </span>
                      {t.unmatchedSellTokens > 0 && (
                        <span className="tag" title="Some sells had no matching buy in the scanned history">
                          Partial
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`status status-${t.status}`}>{STATUS[t.status]}</span>
                    </td>
                    <td className="num">{fmtDuration(t.holdMedianSec)}</td>
                    <td className="num muted">{fmtAgo(t.lastTime)}</td>
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

function EdgeList({ title, edges }: { title: string; edges: FundingEdge[] }) {
  return (
    <div className="edges">
      <p className="mono-label muted">{title}</p>
      {edges.length === 0 ? (
        <p className="muted">None found.</p>
      ) : (
        <ul>
          {edges.map((e) => (
            <li key={e.address}>
              {e.label ? <span className="tag">{e.label}</span> : <Addr address={e.address} href={`/wallet/${e.address}`} />}
              <span className="edges-amt">
                {fmtSol(e.sol)} SOL <span className="muted">({e.count}x)</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
