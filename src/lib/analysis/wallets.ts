import { config } from "../config";
import { computePosition } from "../fifo";
import { deriveAta } from "../solana/address";
import { KNOWN_FUNDERS, LAMPORTS_PER_SOL } from "../solana/constants";
import { getFunders, recordFunding } from "../registry";
import { getHistory } from "../solana/helius";
import { extractActivities, solInflows, sortActivities, txSignature } from "../solana/tx";
import type {
  Cluster,
  EarlyBuyer,
  EarlyWalletDetail,
  Funder,
  FunderNode,
  LaunchAnalysis,
  Position,
  Signal,
  WalletsAnalysis,
} from "../types";

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

async function analyzeOne(
  b: EarlyBuyer,
  launch: LaunchAnalysis,
  onError: (e: unknown) => void,
): Promise<EarlyWalletDetail> {
  let incomplete = false;
  const fail = <T,>(fallback: T) => (e: unknown) => {
    incomplete = true;
    onError(e);
    return fallback;
  };
  const [funder, seen, position] = await Promise.all([
    findFunder(b.wallet, launch).catch(fail(null)),
    firstSeen(b.wallet).catch(fail(null)),
    tokenPosition(b.wallet, launch).catch(fail(computePosition([]))),
  ]);
  return {
    incomplete,
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
function buildClusters(details: EarlyWalletDetail[], launch: LaunchAnalysis, parents: Map<string, Funder | null>): Cluster[] {
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
  // Second hop: funders that were themselves funded from the same (non-exchange) source.
  for (const [funder, parent] of parents) {
    if (parent && !KNOWN_FUNDERS[parent.address]) union(funder, parent.address);
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

/** Group early wallets by direct funder, trace each funder one hop further, and check the cross-launch registry. */
async function buildFunders(
  details: EarlyWalletDetail[],
  launch: LaunchAnalysis,
): Promise<{ nodes: FunderNode[]; parents: Map<string, Funder | null> }> {
  const pct = new Map(launch.earlyBuyers.map((b) => [b.wallet, b.pctSupply]));
  const direct = new Map<string, FunderNode>();
  for (const d of details) {
    if (!d.funder) continue;
    const a = d.funder.address;
    const node =
      direct.get(a) ??
      ({
        address: a,
        label: d.funder.label,
        wallets: [],
        sol: 0,
        pctSupply: 0,
        parent: null,
        otherLaunches: 0,
        otherMints: [],
        clusterId: null,
        isExchange: Boolean(KNOWN_FUNDERS[a]),
      } as FunderNode);
    node.wallets.push(d.wallet);
    node.sol += d.funder.sol;
    node.pctSupply += pct.get(d.wallet) ?? 0;
    direct.set(a, node);
  }

  // Trace the most important non-exchange funders one more hop back.
  const toTrace = [...direct.values()]
    .filter((n) => !n.isExchange)
    .sort((a, b) => b.wallets.length - a.wallets.length || b.pctSupply - a.pctSupply)
    .slice(0, config.secondHopLimit)
    .map((n) => n.address);
  const parents = new Map<string, Funder | null>();
  await Promise.all(
    toTrace.map((a) =>
      findFunder(a, launch)
        .then((f) => parents.set(a, f))
        .catch(() => {}),
    ),
  );
  for (const [a, p] of parents) {
    const n = direct.get(a);
    if (n && p) n.parent = { address: p.address, label: p.label, sol: p.sol };
  }

  // Cross-launch registry: has this funder bankrolled early buyers elsewhere?
  const tracked = [...direct.values()].filter((n) => !n.isExchange);
  const prev = await getFunders(tracked.map((n) => n.address)).catch(() => new Map());
  for (const n of tracked) {
    const others = (prev.get(n.address)?.launches ?? []).filter((l: { mint: string }) => l.mint !== launch.mint);
    n.otherLaunches = others.length;
    n.otherMints = others.slice(0, 5).map((l: { mint: string }) => l.mint);
  }
  await Promise.all(
    tracked.map((n) => recordFunding(n.address, n.label, launch.mint, n.wallets.length, prev.get(n.address) ?? null).catch(() => {})),
  );

  const nodes = [...direct.values()].sort(
    (a, b) => Number(a.isExchange) - Number(b.isExchange) || b.wallets.length - a.wallets.length || b.pctSupply - a.pctSupply,
  );
  return { nodes, parents };
}

function fundingSignals(nodes: FunderNode[]): Signal[] {
  const signals: Signal[] = [];
  for (const n of nodes) {
    if (n.isExchange || !n.otherLaunches) continue;
    signals.push({
      id: `repeat-funder-${n.address}`,
      severity: n.otherLaunches >= 2 ? "high" : "medium",
      title: `A funder here also funded early buyers in ${n.otherLaunches} other launch${n.otherLaunches > 1 ? "es" : ""}`,
      detail: `${n.address.slice(0, 4)}…${n.address.slice(-4)} sent SOL to ${n.wallets.length} early wallet${n.wallets.length > 1 ? "s" : ""} here. Repeat bankrolling of first-block buyers is typical of serial bundlers. Counts only launches looked up on this site.`,
      wallets: n.wallets,
    });
  }
  const byParent = new Map<string, FunderNode[]>();
  for (const n of nodes) {
    if (!n.parent || KNOWN_FUNDERS[n.parent.address]) continue;
    byParent.set(n.parent.address, [...(byParent.get(n.parent.address) ?? []), n]);
  }
  for (const [parent, kids] of byParent) {
    if (kids.length < 2) continue;
    const wallets = kids.flatMap((k) => k.wallets);
    signals.push({
      id: `upstream-${parent}`,
      severity: wallets.length >= 4 ? "high" : "medium",
      title: `${kids.length} different funders trace back to one source`,
      detail: `${wallets.length} early wallets look independently funded, but their funders were all paid by ${parent.slice(0, 4)}…${parent.slice(-4)} before launch.`,
      wallets,
    });
  }
  return signals;
}

export async function analyzeEarlyWallets(launch: LaunchAnalysis): Promise<WalletsAnalysis> {
  let lastError: unknown = null;
  const details = await Promise.all(
    launch.earlyBuyers.map((b) => analyzeOne(b, launch, (e) => (lastError = e))),
  );
  const incompleteWallets = details.filter((d) => d.incomplete).length;
  // If nothing came back at all, surface the real error instead of an empty result.
  if (details.length && incompleteWallets === details.length && lastError) throw lastError;

  const { nodes, parents } = await buildFunders(details, launch);
  const clusters = buildClusters(details, launch, parents);
  for (const n of nodes) n.clusterId = details.find((d) => d.wallet === n.wallets[0])?.clusterId ?? null;
  const signals = [...walletSignals(details, clusters, launch), ...fundingSignals(nodes)];
  // Keep responses small: very active wallets can have hundreds of events on one token.
  for (const d of details) {
    const ev = d.position.events;
    if (ev.length > 60) d.position.events = [...ev.slice(0, 30), ...ev.slice(-30)];
  }
  return {
    mint: launch.mint,
    wallets: details,
    funders: nodes,
    clusters,
    signals,
    incompleteWallets,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
