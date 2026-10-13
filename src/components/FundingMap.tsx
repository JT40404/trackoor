import Addr from "./Addr";
import { fmtPct, fmtSol, short } from "@/lib/format";
import type { Cluster, FunderNode, WalletsAnalysis } from "@/lib/types";

const color = (id: number | null, kind?: Cluster["kind"]) =>
  id === null ? "var(--block)" : kind === "creator" ? "var(--creator)" : `var(--c${id % 8})`;

/** Funder → early-wallet tree, with second-hop sources and cross-launch history. */
export default function FundingMap({ data, creator, total }: { data: WalletsAnalysis; creator: string; total: number }) {
  const kinds = new Map(data.clusters.map((c) => [c.id, c.kind]));
  const linked = data.funders.filter((f) => !f.isExchange);
  const exchanges = data.funders.filter((f) => f.isExchange);
  const shown = linked.filter((f) => f.wallets.length >= 2 || f.otherLaunches > 0 || f.address === creator || f.parent);
  const singles = linked.length - shown.length;
  const traced = data.wallets.filter((w) => w.funder).length;

  // Group exchange-funded wallets by exchange name.
  const byExchange = new Map<string, number>();
  for (const f of exchanges) byExchange.set(f.label ?? "Exchange", (byExchange.get(f.label ?? "Exchange") ?? 0) + f.wallets.length);

  return (
    <div className="fmap">
      <dl className="fmap-summary">
        <div>
          <dt className="mono-label">Funders traced</dt>
          <dd>
            {traced}/{total}
          </dd>
        </div>
        <div>
          <dt className="mono-label">Shared funders</dt>
          <dd>{linked.filter((f) => f.wallets.length >= 2).length}</dd>
        </div>
        <div>
          <dt className="mono-label">Repeat funders</dt>
          <dd className={linked.some((f) => f.otherLaunches) ? "neg" : undefined}>{linked.filter((f) => f.otherLaunches > 0).length}</dd>
        </div>
        <div>
          <dt className="mono-label">From exchanges</dt>
          <dd>{exchanges.reduce((t, f) => t + f.wallets.length, 0)}</dd>
        </div>
      </dl>

      {shown.length === 0 ? (
        <p className="muted">
          No shared or repeat funders among the first {total} buyers.
          {singles > 0 && ` ${singles} wallets each had their own funder.`}
        </p>
      ) : (
        <ul className="fmap-list">
          {shown.map((f) => (
            <FunderRow key={f.address} f={f} creator={creator} kind={f.clusterId !== null ? kinds.get(f.clusterId) : undefined} />
          ))}
        </ul>
      )}

      <p className="fineprint mono-label">
        {singles > 0 &&
          shown.length > 0 &&
          (singles === 1 ? "1 other funder sent SOL to a single wallet. " : `${singles} other funders sent SOL to a single wallet each. `)}
        {byExchange.size > 0 &&
          `Exchange withdrawals (not counted as links): ${[...byExchange].map(([n, c]) => `${n} ${c}`).join(", ")}. `}
        Funders are traced one extra hop back. Repeat counts only include launches looked up on this site.
      </p>
    </div>
  );
}

function FunderRow({ f, creator, kind }: { f: FunderNode; creator: string; kind?: Cluster["kind"] }) {
  return (
    <li className="fnode">
      {f.parent && (
        <div className="fnode-parent">
          <span className="mono-label muted">Funded by</span>{" "}
          {f.parent.label ? <span className="tag">{f.parent.label}</span> : <Addr address={f.parent.address} href={`/wallet/${f.parent.address}`} />}
          <span className="muted"> ({fmtSol(f.parent.sol)} SOL)</span>
        </div>
      )}
      <div className="fnode-head">
        <span className="swatch" style={{ background: color(f.clusterId, kind) }} aria-hidden />
        <Addr address={f.address} href={`/wallet/${f.address}`} />
        {f.address === creator && <span className="tag tag-creator">Creator</span>}
        {f.label && f.address !== creator && <span className="tag">{f.label}</span>}
        {f.otherLaunches > 0 && (
          <span className="tag tag-warn" title={f.otherMints.join(", ")}>
            Seen in {f.otherLaunches} other launch{f.otherLaunches > 1 ? "es" : ""}
          </span>
        )}
        <span className="fnode-stats mono-label muted">
          {f.wallets.length} wallet{f.wallets.length > 1 ? "s" : ""}, {fmtPct(f.pctSupply)} supply, {fmtSol(f.sol)} SOL sent
        </span>
      </div>
      <ul className="fnode-kids">
        {f.wallets.map((w) => (
          <li key={w}>
            <a href={`#w-${w}`} className="chip">
              {short(w)}
            </a>
          </li>
        ))}
      </ul>
      {f.otherMints.length > 0 && (
        <p className="fnode-other mono-label muted">
          Also in:{" "}
          {f.otherMints.map((m, i) => (
            <span key={m}>
              {i > 0 && ", "}
              <a href={`/token/${m}`}>{short(m)}</a>
            </span>
          ))}
        </p>
      )}
    </li>
  );
}
