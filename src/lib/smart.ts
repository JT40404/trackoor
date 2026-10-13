import type { TraderLabel, TraderRating, TraderStats } from "./types";

/**
 * Smart-wallet rules. Everything that decides a label lives here so it's easy to tune.
 * Stats come from each wallet's recent history only (see SMART_TX_LIMIT), so treat
 * ratings as "how this wallet has traded lately", not a lifetime record.
 */
export const SMART_RULES = {
  /** Fewer closed positions than this and we don't judge. */
  minClosed: 5,
  /** Smart needs at least this win rate... */
  minWinRate: 0.5,
  /** ...this much realized profit, in SOL... */
  minPnlSol: 1,
  /** ...and a median hold at least this long (seconds). Shorter = flipper. */
  convictionHoldSec: 30 * 60,
  /** Median hold under this with lots of trades looks automated. */
  botHoldSec: 60,
  botMinClosed: 10,
  /** Below this win rate, call it losing even if PnL is slightly positive. */
  losingWinRate: 0.35,
};

export const TRADER_LABELS: Record<TraderLabel, string> = {
  smart: "Smart",
  flipper: "Profitable flipper",
  bot: "Bot-like",
  losing: "Losing",
  unproven: "Unproven",
};

const fmtHold = (s: number) =>
  s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`;

export function classifyTrader(s: TraderStats | null): TraderRating {
  const r = SMART_RULES;
  if (!s || s.closedPositions < r.minClosed || s.winRate === null) {
    const n = s?.closedPositions ?? 0;
    return {
      label: "unproven",
      score: null,
      reasons: [n ? `Only ${n} closed trade${n === 1 ? "" : "s"} in recent history` : "No closed trades in recent history"],
    };
  }

  const hold = s.medianHoldSec ?? 0;
  const pnlPart = Math.min(30, Math.log10(1 + Math.max(0, s.realizedPnlSol)) * 15);
  const holdPart = hold >= r.convictionHoldSec ? 20 : hold <= r.botHoldSec ? 0 : ((hold - r.botHoldSec) / (r.convictionHoldSec - r.botHoldSec)) * 20;
  const samplePart = Math.min(1, s.closedPositions / 20) * 10;
  let score = Math.round(s.winRate * 40 + pnlPart + holdPart + samplePart);

  const reasons = [
    `${Math.round(s.winRate * 100)}% win rate over ${s.closedPositions} closed trades`,
    `${s.realizedPnlSol >= 0 ? "+" : "−"}${Math.abs(s.realizedPnlSol).toFixed(2)} SOL realized`,
    `Median hold ${fmtHold(hold)}`,
  ];

  let label: TraderLabel;
  if (s.realizedPnlSol <= 0 || s.winRate < r.losingWinRate) {
    label = "losing";
    score = Math.min(score, 25);
  } else if (hold < r.botHoldSec && s.closedPositions >= r.botMinClosed) {
    label = "bot";
  } else if (s.realizedPnlSol >= r.minPnlSol && s.winRate >= r.minWinRate && hold >= r.convictionHoldSec) {
    label = "smart";
  } else {
    label = "flipper";
  }
  return { label, score: Math.max(0, Math.min(100, score)), reasons };
}
