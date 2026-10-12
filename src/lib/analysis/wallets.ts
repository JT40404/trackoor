import { config } from "../config";
import { computePosition } from "../fifo";
import { deriveAta } from "../solana/address";
import { KNOWN_FUNDERS, LAMPORTS_PER_SOL } from "../solana/constants";
import { getHistory } from "../solana/helius";
import { extractActivities, solInflows, sortActivities, txSignature } from "../solana/tx";
import type { Cluster, EarlyBuyer, EarlyWalletDetail, Funder, LaunchAnalysis, Position, Signal, WalletsAnalysis } from "../types";

const pct = (n: number) => `${n.toFixed(n < 1 ? 2 : 1)}%`;

/** Most recent meaningful SOL inflow before launch. */
async function findFunder(wallet: string, launch: LaunchAnalysis): Promise<Funder | null> {
  const { data } = await getHistory(wallet, {
    sortOrder: "desc",
    limit: config.fundingLookback,
    filters: { status: "succeeded", slot: { lte: launch.createSlot } },
  });
  for (const tx of data) {
    const inflow = solInflows(tx, wallet)
      .filter((i) => i.lamports >= config.minFundingLamports)
      .sort((a, b) => b.lamports - a.lamports)[0];
    if (inflow) {
      return {
        address: inflow.source,
        sol: inflow.lamports / LAMPORTS_PER_SOL,
        time: tx.blockTime ?? 0,
        signature: txSignature(tx),
        label: KNOWN_FUNDERS[inflow.source] ?? (inflow.source === launch.creator ? "Creator" : undefined),
      };
    }
  }
  return null;
}

async function firstSeen(wallet: string): Promise<number | null> {
  const { data } = await getHistory(wallet, { sortOrder: "asc", limit: 1, details: "signatures" });
  return data[0]?.blockTime ?? null;
}

/** All activity on this token, via the wallet's associated token account history. */
async function tokenPosition(wallet: string, launch: LaunchAnalysis): Promise<Position> {
  const ata = deriveAta(wallet, launch.mint, launch.meta.tokenProgram);
  const { data, paginationToken } = await getHistory(ata, {
    sortOrder: "asc",
    limit: config.positionPageSize,
    maxPages: config.positionMaxPages,
    filters: { status: "succeeded" },
  });
  const acts = sortActivities(data.flatMap((tx) => extractActivities(tx, { wallet, mint: launch.mint, includeTransfers: true })));
  const pos = computePosition(
    acts.map((a) => ({
      kind: a.kind,
      tokens: a.tokens,
      sol: a.sol,
      time: a.blockTime,
      signature: a.signature,
      venue: a.venue,
      counterparty: a.counterparty,
    })),
  );
  pos.truncated = Boolean(paginationToken);
  return pos;
}

async function analyzeOne(b: EarlyBuyer, launch: LaunchAnalysis): Promise<EarlyWalletDetail> {
  const [funder, seen, position] = await Promise.all([
    findFunder(b.wallet, launch).catch(() => null),
    firstSeen(b.wallet).catch(() => null),
    tokenPosition(b.wallet, launch),
  ]);
  return {
    wallet: b.wallet,
    funder,
    firstSeen: seen,
    ageAtLaunchSec: seen !== null ? Math.max(0, launch.createTime - seen) : null,
    position,
    remainingPctSupply: (position.remainingTokens / launch.meta.supply) * 100,
    clusterId: null,
  };
}

/** Union-find over early wallets + creator, linked by funding edges (exchanges excluded). */
function buildClusters(details: EarlyWalletDetail[], launch: LaunchAnalysis): Cluster[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  find(launch.creator);
  for (const d of details) {
    find(d.wallet);
    if (d.funder && !KNOWN_FUNDERS[d.funder.address]) union(d.wallet, d.funder.address);
  }

  const groups = new Map<string, string[]>();
  for (const d of details) {
    const r = find(d.wallet);
    groups.set(r, [...(groups.get(r) ?? []), d.wallet]);
  }

  const buyerByWallet = new Map(launch.earlyBuyers.map((b) => [b.wallet, b]));
  const creatorRoot = find(launch.creator);
  const clusters: Cluster[] = [];
  for (const [root, wallets] of groups) {
    const isCreator = root === creatorRoot;
    const members = wallets.filter((w) => w !== launch.creator);
    if (members.length < (isCreator ? 1 : 2)) continue;
    // Display the most common direct funder as the cluster's root.
    const funders = new Map<string, number>();
    for (const w of wallets) {
      const f = details.find((d) => d.wallet === w)?.funder?.address;
      if (f) funders.set(f, (funders.get(f) ?? 0) + 1);
    }
    const shownRoot = isCreator ? launch.creator : ([...funders.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? root);
    clusters.push({
      id: 0,
      kind: isCreator ? "creator" : "shared",
      root: shownRoot,
      rootLabel: isCreator ? "Creator" : undefined,
      wallets,
      pctSupply: wallets.reduce((t, w) => t + (buyerByWallet.get(w)?.pctSupply ?? 0), 0),
      sol: wallets.reduce((t, w) => t + (buyerByWallet.get(w)?.sol ?? 0), 0),
    });
  }
  clusters.sort((a, b) => (a.kind === "creator" ? -1 : b.kind === "creator" ? 1 : b.pctSupply - a.pctSupply));
  clusters.forEach((c, i) => (c.id = i));
  for (const c of clusters) for (const w of c.wallets) {
    const d = details.find((x) => x.wallet === w);
    if (d) d.clusterId = c.id;
  }
  return clusters;
}

function walletSignals(details: EarlyWalletDetail[], clusters: Cluster[], launch: LaunchAnalysis): Signal[] {
  const signals: Signal[] = [];

  const creatorCluster = clusters.find((c) => c.kind === "creator");
  if (creatorCluster) {
    const others = creatorCluster.wallets.filter((w) => w !== launch.creator);
    signals.push({
      id: "creator-funded",
      severity: "high",
      title: `${others.length} early wallet${others.length > 1 ? "s are" : " is"} linked to the creator by funding`,
      detail: `Their SOL traces back to the creator or the creator's funder. Together with the creator they bought ${pct(creatorCluster.pctSupply)} of supply early.`,
      wallets: others,
    });
  }

  for (const c of clusters.filter((x) => x.kind === "shared")) {
    signals.push({
      id: `cluster-${c.id}`,
      severity: c.pctSupply >= 10 || c.wallets.length >= 4 ? "high" : "medium",
      title: `${c.wallets.length} early wallets share a funder`,
      detail: `All were funded from the same source before launch and bought ${pct(c.pctSupply)} of supply between them.`,
      wallets: c.wallets,
    });
  }

  const fresh = details.filter((d) => d.ageAtLaunchSec !== null && d.ageAtLaunchSec < 86_400 && d.wallet !== launch.creator);
  if (fresh.length >= 3) {
    signals.push({
      id: "fresh-wallets",
      severity: fresh.length >= 6 ? "high" : "medium",
      title: `${fresh.length} early wallets were created less than a day before launch`,
      detail: "Fresh wallets with no prior history are the usual vehicle for bundled buys.",
      wallets: fresh.map((d) => d.wallet),
    });
  }

  const destinations = new Map<string, Set<string>>();
  for (const d of details) {
    for (const e of d.position.events) {
      if (e.kind === "transfer_out" && e.counterparty) {
        const s = destinations.get(e.counterparty) ?? new Set<string>();
        s.add(d.wallet);
        destinations.set(e.counterparty, s);
      }
    }
  }
  for (const [dest, from] of destinations) {
    if (from.size >= 2) {
      signals.push({
        id: `consolidate-${dest}`,
        severity: "high",
        title: `${from.size} early wallets sent tokens to the same address`,
        detail: `Tokens were consolidated into ${dest.slice(0, 4)}…${dest.slice(-4)} instead of being sold directly, a common way to hide that the wallets are related.`,
        wallets: [...from],
      });
    }
  }

  const stillHeld = details.reduce((t, d) => t + d.remainingPctSupply, 0);
  if (stillHeld >= 5) {
    signals.push({
      id: "still-holding",
      severity: stillHeld >= 25 ? "medium" : "info",
      title: `Early wallets still hold ${pct(stillHeld)} of supply`,
      detail: "This is supply that can still be sold into buyers. It isn't a bundling signal by itself.",
      wallets: details.filter((d) => d.remainingPctSupply > 0.1).map((d) => d.wallet),
    });
  }

  return signals;
}

export async function analyzeEarlyWallets(launch: LaunchAnalysis): Promise<WalletsAnalysis> {
  const details = await Promise.all(launch.earlyBuyers.map((b) => analyzeOne(b, launch)));
  const clusters = buildClusters(details, launch);
  const signals = walletSignals(details, clusters, launch);
  // Keep responses small: very active wallets can have hundreds of events on one token.
  for (const d of details) {
    const ev = d.position.events;
    if (ev.length > 60) d.position.events = [...ev.slice(0, 30), ...ev.slice(-30)];
  }
  return {
    mint: launch.mint,
    wallets: details,
    clusters,
    signals,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
