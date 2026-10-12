import { config } from "../config";
import { HttpError } from "../errors";
import { computePosition } from "../fifo";
import { getHistory } from "../solana/helius";
import { extractActivities, sortActivities, type Activity } from "../solana/tx";
import { median } from "../stats";
import type { TokenPosition, WalletProfile } from "../types";

/** Cross-token trading history for one wallet, from its most recent transactions. */
export async function analyzeWallet(wallet: string): Promise<WalletProfile> {
  const [recent, oldest] = await Promise.all([
    getHistory(wallet, {
      sortOrder: "desc",
      limit: config.profilePageSize,
      maxPages: config.profileMaxPages,
      filters: { status: "succeeded", tokenAccounts: "balanceChanged" },
    }),
    getHistory(wallet, { sortOrder: "asc", limit: 1, details: "signatures" }).catch(() => ({ data: [], paginationToken: null })),
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
