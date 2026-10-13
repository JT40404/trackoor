"use client";

import Link from "next/link";
import Addr from "./Addr";
import Frame from "./Frame";
import Loading from "./Loading";
import SectionHead from "./SectionHead";
import SevMark from "./SevMark";
import Strip from "./Strip";
import { useApi } from "./useApi";
import { fmtAgo, fmtDate, fmtDuration, fmtPct, fmtSol, short, solscanTx } from "@/lib/format";
import { scoreSignals, sortSignals } from "@/lib/score";
import type {
  Cluster,
  EarlyBuyer,
  EarlyWalletDetail,
  LaunchAnalysis,
  PositionStatus,
  Signal,
  WalletsAnalysis,
} from "@/lib/types";

const STATUS: Record<PositionStatus, string> = {
  holding: "Holding",
  partial: "Sold some",
  exited: "Sold all",
  transferred: "Moved out",
  unknown: "No activity found",
};

const SEVERITY: Record<Signal["severity"], string> = { high: "High", medium: "Medium", low: "Low", info: "Note" };

const clusterColor = (id: number | null | undefined, kind?: Cluster["kind"]) =>
  id === null || id === undefined ? undefined : kind === "creator" ? "var(--creator)" : `var(--c${id % 8})`;

export default function TokenView({ ca }: { ca: string }) {
  const launch = useApi<LaunchAnalysis>(`/api/token/${ca}`);
  const wallets = useApi<WalletsAnalysis>(launch.status === "ready" ? `/api/token/${ca}/wallets` : null);

  if (launch.status === "loading") {
    return (
      <Loading
        title="Reading launch"
        steps={[`Fetch first transactions for ${short(ca)}`, "Decode pump.fun trades", "Rank early buyers", "Score launch signals"]}
      />
    );
  }
  if (launch.status === "error") {
    return (
      <section className="empty" role="alert">
        <span className="mono-label">[{launch.code || "ERR"}]</span>
        <h1>{launch.error}</h1>
        {launch.hint && <p>{launch.hint}</p>}
        {launch.code === 404 && (
          <p>
            <Link href={`/wallet/${ca}`}>Look up {short(ca)} as a wallet</Link>
          </p>
        )}
      </section>
    );
  }

  const l = launch.data;
  const w = wallets.status === "ready" ? wallets.data : null;
  const details = new Map(w?.wallets.map((d) => [d.wallet, d]) ?? []);
  const clusterById = new Map(w?.clusters.map((c) => [c.id, c]) ?? []);
  const colorFor = (wallet: string) => {
    if (wallet === l.creator) return "var(--creator)";
    const d = details.get(wallet);
    if (!d || d.clusterId === null) return undefined;
    return clusterColor(d.clusterId, clusterById.get(d.clusterId)?.kind);
  };

  const signals = sortSignals([...l.signals, ...(w?.signals ?? [])]);
  const { score, verdict, level } = scoreSignals(signals);
  const title = l.meta.name ?? "Unnamed token";

  const shown = l.slots.slice(0, Math.max(3, ...l.slots.filter((x) => x.buys.length).map((x) => x.offset)) + 1);

  return (
    <article className="token">
      <header className="token-head">
        <div className="token-id">
          {l.meta.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.meta.image} alt="" className="token-img" width={64} height={64} />
          )}
          <div>
            <h1>{title}</h1>
            {l.meta.symbol && <span className="mono-label muted">${l.meta.symbol}</span>}
          </div>
        </div>
        <dl className="token-meta">
          <div>
            <dt className="mono-label">Contract</dt>
            <dd>
              <Addr address={l.mint} full />
            </dd>
          </div>
          <div>
            <dt className="mono-label">Created</dt>
            <dd>
              {fmtDate(l.createTime)} <span className="muted">({fmtAgo(l.createTime)})</span>
            </dd>
          </div>
          <div>
            <dt className="mono-label">Creator</dt>
            <dd>
              <Addr address={l.creator} href={`/wallet/${l.creator}`} />
            </dd>
          </div>
        </dl>
      </header>

      <section className={`verdict verdict-${level}`} aria-live="polite">
        <span className="verdict-mark" aria-hidden />
        <div>
          <p className="verdict-text">{verdict}</p>
          <p className="verdict-sub">
            <span className="mono-label">
              Score {score}/100, {signals.filter((s) => s.severity !== "info").length} flags
            </span>
            {wallets.status === "loading" && <span className="muted"> Funding and holding checks are still running, so this may go up.</span>}
            {wallets.status === "error" && <span className="muted"> Funding checks failed: {wallets.error}</span>}
            {w && w.incompleteWallets > 0 && (
              <span className="muted">
                {" "}
                {w.incompleteWallets} of {w.wallets.length} wallets couldn&apos;t be fully checked because the data
                provider was busy. Reload in a minute to fill them in.
              </span>
            )}
          </p>
        </div>
      </section>

      <section className="sec" aria-labelledby="strip-h">
        <SectionHead
          n={1}
          id="strip-h"
          title={`The first ${shown.length} slots`}
          note="Each block is one buy, sized by share of supply. Slots are about 0.4 seconds apart. Color marks wallets linked by funding; gray means no link found."
        />
        <Frame className="strip-frame">
          <Strip cols={shown} colorFor={colorFor} creator={l.creator} label="Buys per slot after token creation" />
        </Frame>
      </section>

      <div className="split">
        <section className="sec" aria-labelledby="signals-h">
          <SectionHead n={2} id="signals-h" title="What stands out" />
          {signals.length ? (
            <ul className="signals">
              {signals.map((s, i) => (
                <li key={s.id} className={`signal sev-${s.severity}`}>
                  <div className="signal-code">
                    <SevMark severity={s.severity} />
                    <span className="mono-label">
                      Sig-{String(i + 1).padStart(2, "0")} {SEVERITY[s.severity]}
                    </span>
                  </div>
                  <p className="signal-title">{s.title}</p>
                  <p className="signal-detail">{s.detail}</p>
                  {s.wallets && s.wallets.length > 0 && (
                    <p className="signal-wallets">
                      {s.wallets.slice(0, 8).map((x) => (
                        <a key={x} href={`#w-${x}`} className="chip">
                          {short(x)}
                        </a>
                      ))}
                      {s.wallets.length > 8 && <span className="muted">and {s.wallets.length - 8} more</span>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing unusual in the launch window.</p>
          )}
        </section>

        <section className="sec" aria-labelledby="clusters-h">
          <SectionHead n={3} id="clusters-h" title="Linked wallets" />
          {wallets.status === "loading" && (
            <p className="mono-label muted">
              Tracing SOL for the first {l.earlyBuyers.length} buyers <span className="spin" aria-hidden />
            </p>
          )}
          {wallets.status === "error" && <p className="muted">{wallets.error}</p>}
          {w && !w.clusters.length && (
            <p className="muted">
              No shared funders among the first {l.earlyBuyers.length} buyers. Exchange withdrawals don&apos;t count as links.
            </p>
          )}
          {w && w.clusters.length > 0 && (
            <ul className="clusters">
              {w.clusters.map((c, i) => (
                <li key={c.id}>
                  <span className="swatch" style={{ background: clusterColor(c.id, c.kind) }} aria-hidden />
                  <div>
                    <p className="cluster-title">
                      {c.kind === "creator"
                        ? "Creator's group"
                        : `Group ${String.fromCharCode(65 + i - (w.clusters[0].kind === "creator" ? 1 : 0))}`}
                    </p>
                    <p className="muted">
                      {c.wallets.length} wallets, {fmtPct(c.pctSupply)} of supply, {fmtSol(c.sol)} SOL in.
                    </p>
                    {c.kind === "shared" && (
                      <p className="cluster-root">
                        <span className="mono-label muted">Funder</span> <Addr address={c.root} href={`/wallet/${c.root}`} />
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <BuyersTable buyers={l.earlyBuyers} details={details} pending={wallets.status === "loading"} colorFor={colorFor} />

      <p className="fineprint mono-label">
        Based on the first {l.txsScanned} transactions, through slot {l.windowEndSlot.toLocaleString()}. Creation tx{" "}
        <a href={solscanTx(l.createSignature)} target="_blank" rel="noreferrer">
          {short(l.createSignature, 6)}
        </a>
      </p>
    </article>
  );
}

function BuyersTable({
  buyers,
  details,
  pending,
  colorFor,
}: {
  buyers: EarlyBuyer[];
  details: Map<string, EarlyWalletDetail>;
  pending: boolean;
  colorFor: (w: string) => string | undefined;
}) {
  const wait = <span className="spin muted" aria-label="Loading" />;
  return (
    <section className="sec" aria-labelledby="buyers-h">
      <SectionHead n={4} id="buyers-h" title={`First ${buyers.length} buyers`} />
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Wallet</th>
              <th scope="col">Entry</th>
              <th scope="col" className="num">SOL in</th>
              <th scope="col" className="num">Supply</th>
              <th scope="col">Funded by</th>
              <th scope="col" className="num">Wallet age</th>
              <th scope="col">Now</th>
              <th scope="col" className="num">Held for</th>
              <th scope="col" className="num">Still holds</th>
              <th scope="col" className="num">Realized</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((b) => {
              const d = details.get(b.wallet);
              const color = colorFor(b.wallet);
              return (
                <tr key={b.wallet} id={`w-${b.wallet}`}>
                  <td className="num muted">{b.rank}</td>
                  <td>
                    <span className="wallet-cell">
                      <span className="swatch" style={{ background: color ?? "transparent" }} aria-hidden />
                      <Addr address={b.wallet} href={`/wallet/${b.wallet}`} />
                      {d?.incomplete && (
                        <span className="tag" title="Some lookups for this wallet failed. Reload to retry.">
                          Partial
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <a href={solscanTx(b.firstSignature)} target="_blank" rel="noreferrer" className="entry">
                      {b.slotOffset === 0 ? "Create slot" : `+${b.slotOffset} slots`}
                    </a>
                    {b.isCreator && <span className="tag tag-creator">Creator</span>}
                    {b.multiWalletTx && !b.isCreator && <span className="tag tag-warn">Shared tx</span>}
                    {b.jitoTip > 0 && <span className="tag">Jito</span>}
                  </td>
                  <td className="num">{fmtSol(b.sol)}</td>
                  <td className="num">{fmtPct(b.pctSupply)}</td>
                  <td>
                    {d ? (
                      d.funder ? (
                        d.funder.label ? (
                          <span className="tag">{d.funder.label}</span>
                        ) : (
                          <Addr address={d.funder.address} href={`/wallet/${d.funder.address}`} />
                        )
                      ) : (
                        <span className="muted">Not found</span>
                      )
                    ) : pending ? (
                      wait
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="num">
                    {d ? (
                      d.ageAtLaunchSec === null ? (
                        "–"
                      ) : (
                        <span className={d.ageAtLaunchSec < 86400 ? "warn" : undefined}>{fmtDuration(d.ageAtLaunchSec)}</span>
                      )
                    ) : pending ? (
                      wait
                    ) : (
                      "–"
                    )}
                  </td>
                  <td>{d ? <span className={`status status-${d.position.status}`}>{STATUS[d.position.status]}</span> : pending ? wait : "–"}</td>
                  <td className="num">{d ? fmtDuration(d.position.holdMedianSec) : pending ? wait : "–"}</td>
                  <td className="num">{d ? fmtPct(d.remainingPctSupply) : pending ? wait : "–"}</td>
                  <td className="num">
                    {d ? (
                      <span className={d.position.realizedPnlSol > 0 ? "pos" : d.position.realizedPnlSol < 0 ? "neg" : undefined}>
                        {fmtSol(d.position.realizedPnlSol, true)}
                      </span>
                    ) : pending ? (
                      wait
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fineprint mono-label">
        Wallet age is time between the wallet&apos;s first transaction and the launch. Held for is the token-weighted median
        time from buy to sell or transfer. Realized is in SOL and counts only tokens bought, not received.
      </p>
    </section>
  );
}
