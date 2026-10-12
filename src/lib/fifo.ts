import { weightedMedian } from "./stats";
import type { Position, PositionEvent } from "./types";

interface Lot {
  tokens: number;
  costPerToken: number | null; // null when acquired by transfer (unknown cost)
  time: number;
}

/**
 * FIFO lot matching. Each buy (or incoming transfer) opens a lot; sells and outgoing
 * transfers close the oldest lots first. Hold time = close time - lot open time.
 * Realized PnL only counts lots with a known cost (i.e. bought, not received).
 */
export function computePosition(events: PositionEvent[], now = Math.floor(Date.now() / 1000)): Position {
  const lots: Lot[] = [];
  const holds: { value: number; weight: number }[] = [];
  const p: Position = {
    status: "unknown",
    boughtTokens: 0,
    soldTokens: 0,
    transferredIn: 0,
    transferredOut: 0,
    remainingTokens: 0,
    solIn: 0,
    solOut: 0,
    realizedPnlSol: 0,
    holdMedianSec: null,
    holdingSince: null,
    firstTime: events[0]?.time ?? null,
    lastTime: events[events.length - 1]?.time ?? null,
    buys: 0,
    sells: 0,
    unmatchedSellTokens: 0,
    events,
  };

  const consume = (amount: number, time: number, proceedsPerToken: number | null) => {
    let left = amount;
    while (left > 1e-9 && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.tokens, left);
      holds.push({ value: Math.max(0, time - lot.time), weight: take });
      if (proceedsPerToken !== null && lot.costPerToken !== null) {
        p.realizedPnlSol += take * (proceedsPerToken - lot.costPerToken);
      }
      lot.tokens -= take;
      left -= take;
      if (lot.tokens <= 1e-9) lots.shift();
    }
    return left; // tokens with no matching lot
  };

  for (const e of events) {
    if (e.tokens <= 0) continue;
    switch (e.kind) {
      case "buy":
        p.buys++;
        p.boughtTokens += e.tokens;
        p.solIn += e.sol;
        lots.push({ tokens: e.tokens, costPerToken: e.sol / e.tokens, time: e.time });
        break;
      case "transfer_in":
        p.transferredIn += e.tokens;
        lots.push({ tokens: e.tokens, costPerToken: null, time: e.time });
        break;
      case "sell": {
        p.sells++;
        p.soldTokens += e.tokens;
        p.solOut += e.sol;
        const unmatched = consume(e.tokens, e.time, e.sol / e.tokens);
        p.unmatchedSellTokens += unmatched;
        break;
      }
      case "transfer_out":
        p.transferredOut += e.tokens;
        consume(e.tokens, e.time, null);
        break;
    }
  }

  p.remainingTokens = lots.reduce((t, l) => t + l.tokens, 0);
  p.holdingSince = lots[0]?.time ?? null;
  p.holdMedianSec = weightedMedian(holds);
  // Still-held tokens count toward hold time as "held so far" only if nothing was ever closed.
  if (p.holdMedianSec === null && p.holdingSince !== null) p.holdMedianSec = now - p.holdingSince;

  const acquired = p.boughtTokens + p.transferredIn;
  const dust = Math.max(acquired * 0.001, 1);
  if (!events.length) p.status = "unknown";
  else if (p.remainingTokens <= dust) p.status = p.transferredOut > p.soldTokens ? "transferred" : "exited";
  else if (p.soldTokens > 0 || p.transferredOut > 0) p.status = "partial";
  else p.status = "holding";
  return p;
}
