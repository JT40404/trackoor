import { config } from "../config";
import { HttpError } from "../errors";
import { computePosition } from "../fifo";
import { getFunder } from "../registry";
import { KNOWN_FUNDERS, LAMPORTS_PER_SOL } from "../solana/constants";
import { getHistory } from "../solana/helius";
import { extractActivities, solInflows, solOutflows, sortActivities, type Activity } from "../solana/tx";
import type { RawTx } from "../solana/types";
import { median } from "../stats";
import type { FundingEdge, TokenPosition, TraderStats, WalletProfile } from "../types";

interface ProfileOptions {
  pageSize?: number;
  maxPages?: number;
  /** Extra call to find the wallet's first-ever transaction. */
  firstSeen?: boolean;
}

function topEdges(map: Map<string, { sol: number; count: number }>, limit = 8): FundingEdge[] {
  return [...map.entries()]
    .map(([address, v]) => ({ address, label: KNOWN_FUNDERS[address], ...v }))
    .sort((a, b) => b.sol - a.sol)
    .slice(0, limit);
}

function fundingFrom(txs: RawTx[], wallet: string) {
  const sources = new Map<string, { sol: number; count: number }>();
  const recipients = new Map<string, { sol: number; count: number }>();
  for (const tx of txs) {
    for (const i of solInflows(tx, wallet)) {
      if (i.lamports < config.minFundingLamports) continue;
      const e = sources.get(i.source) ?? { sol: 0, count: 0 };
      e.sol += i.lamports / LAMPORTS_PER_SOL;
      e.count++;
      sources.set(i.source, e);
    }
    for (const o of solOutflows(tx, wallet)) {
      if (o.lamports < config.minFundingLamports) continue;
      const e = recipients.get(o.destination) ?? { sol: 0, count: 0 };
      e.sol += o.lamports / LAMPORTS_PER_SOL;
      e.count++;
      recipients.set(o.destination, e);
    }
  }
  return { sources: topEdges(sources), recipients: topEdges(recipients) };
}

/** Cross-token trading history for one wallet, from its most recent transactions. */
export async function analyzeWallet(wallet: string, opts: ProfileOptions = {}): Promise<WalletProfile> {
  const { pageSize = config.profilePageSize, maxPages = config.profileMaxPages, firstSeen = true } = opts;
  const [recent, oldest, asFunder] = await Promise.all([
    getHistory(wallet, {
      sortOrder: "desc",
      limit: pageSize,
      maxPages,
      filters: { status: "succeeded", tokenAccounts: "balanceChanged" },
    }),
    firstSeen
      ? getHistory(wallet, { sortOrder: "asc", limit: 1, details: "signatures" }).catch(() => ({ data: [], paginationToken: null }))
      : Promise.resolve({ data: [], paginationToken: null }),
    firstSeen ? getFunder(wallet).catch(() => null) : Promise.resolve(null),
  ]);
  if (!recent.data.length) throw new HttpError(404, "No transactions found for this wallet.");

  const acts = sortActivities(recent.data.flatMap((tx) => extractActivities(tx, { wallet, includeTransfers: true })));
  const byMint = new Map<string, Activity[]>();
  for (const a of acts) byMint.set(a.mint, [...(byMint.get(a.mint) ?? []), a]);

  const tokens: TokenPosition[] = [];
  for (const [mint, list] of byMint) {
    if (!list.some((a) => a.kind === "buy" || a.kind === "sell")) continue; // transfers only: airdrops, spam
    const pos = computePosition(
      list.map((a) => ({ kind: a.kind, tokens: a.tokens, sol: a.sol, time: a.blockTime, signature: a.signature, venue: a.venue })),
    );
    const venues = new Set(list.filter((a) => a.venue !== "transfer").map((a) => a.venue));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { events, ...rest } = pos;
    tokens.push({ ...rest, mint, venue: venues.size > 1 ? "mixed" : venues.has("pump") ? "pump" : "other" });
  }
  tokens.sort((a, b) => (b.lastTime ?? 0) - (a.lastTime ?? 0));

  // Closed = fully exited with every sell matched to a buy we saw.
  const closed = tokens.filter((t) => t.status === "exited" && t.unmatchedSellTokens < t.soldTokens * 0.01 && t.buys > 0);
  const buys = acts.filter((a) => a.kind === "buy");
  const trades = acts.filter((a) => a.kind === "buy" || a.kind === "sell");

  return {
    wallet,
    firstSeen: oldest.data[0]?.blockTime ?? null,
    tokens,
    funding: fundingFrom(recent.data, wallet),
    fundedLaunches: asFunder?.launches ?? [],
    stats: {
      tokensTraded: tokens.length,
      closedPositions: closed.length,
      winRate: closed.length ? closed.filter((t) => t.realizedPnlSol > 0).length / closed.length : null,
      realizedPnlSol: closed.reduce((t, p) => t + p.realizedPnlSol, 0),
      solVolume: trades.reduce((t, a) => t + a.sol, 0),
      medianHoldSec: median(closed.map((t) => t.holdMedianSec).filter((x): x is number => x !== null)),
      avgBuySol: buys.length ? buys.reduce((t, a) => t + a.sol, 0) / buys.length : null,
      pumpShare: trades.length ? trades.filter((a) => a.venue === "pump").length / trades.length : null,
    },
    txsScanned: recent.data.length,
    truncated: Boolean(recent.paginationToken),
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

export function traderStatsFrom(p: WalletProfile): TraderStats {
  return {
    closedPositions: p.stats.closedPositions,
    tokensTraded: p.stats.tokensTraded,
    winRate: p.stats.winRate,
    realizedPnlSol: p.stats.realizedPnlSol,
    medianHoldSec: p.stats.medianHoldSec,
    avgBuySol: p.stats.avgBuySol,
    txsScanned: p.txsScanned,
  };
}

/** Lighter, stats-only version used to rate many wallets at once. */
export async function traderStats(wallet: string): Promise<TraderStats | null> {
  try {
    const p = await analyzeWallet(wallet, { pageSize: config.smartTxLimit, maxPages: 1, firstSeen: false });
    return traderStatsFrom(p);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null; // no history: unproven
    throw e;
  }
}
