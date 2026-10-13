import "server-only";
import { hasRedis, redis } from "./cache";
import type { LeaderboardFunder, LeaderboardWallet, TraderRating, TraderStats } from "./types";

/**
 * A running record built from every lookup on the site:
 *  - wallets rated smart / profitable, and which launches they showed up early in
 *  - funders that bankrolled early buyers, and in how many launches
 * Stored in Redis when configured (shared, survives deploys); otherwise in memory per instance.
 */

const P = "reg1";
const SMART_Z = `${P}:smart`;
const FUNDERS_Z = `${P}:funders`;
const smartKey = (w: string) => `${P}:smart:${w}`;
const funderKey = (a: string) => `${P}:funder:${a}`;
const SMART_TTL = 60 * 60 * 24 * 30;
const FUNDER_TTL = 60 * 60 * 24 * 60;
const MAX_MINTS = 20;

const mem = {
  smart: new Map<string, LeaderboardWallet>(),
  funders: new Map<string, LeaderboardFunder>(),
};

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redis<string>(["GET", key]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

/* ---------------- smart wallets ---------------- */

export async function recordTrader(wallet: string, rating: TraderRating, stats: TraderStats, mint?: string) {
  if ((rating.label !== "smart" && rating.label !== "flipper") || rating.score === null) {
    // No longer qualifies: drop it from the board.
    if (hasRedis) await redis(["ZREM", SMART_Z, wallet]);
    else mem.smart.delete(wallet);
    return;
  }
  const prev = hasRedis ? await getJson<LeaderboardWallet>(smartKey(wallet)) : mem.smart.get(wallet) ?? null;
  const mints = [...new Set([...(mint ? [mint] : []), ...(prev?.mints ?? [])])].slice(0, MAX_MINTS);
  const entry: LeaderboardWallet = { wallet, rating, stats, mints, lastSeen: now() };
  if (hasRedis) {
    await Promise.all([
      redis(["SET", smartKey(wallet), JSON.stringify(entry), "EX", SMART_TTL]),
      redis(["ZADD", SMART_Z, rating.score, wallet]),
    ]);
  } else {
    mem.smart.set(wallet, entry);
  }
}

export async function topTraders(limit = 50): Promise<LeaderboardWallet[]> {
  if (!hasRedis) {
    return [...mem.smart.values()].sort((a, b) => (b.rating.score ?? 0) - (a.rating.score ?? 0)).slice(0, limit);
  }
  const ids = (await redis<string[]>(["ZRANGE", SMART_Z, 0, limit - 1, "REV"])) ?? [];
  if (!ids.length) return [];
  const raws = (await redis<(string | null)[]>(["MGET", ...ids.map(smartKey)])) ?? [];
  const out: LeaderboardWallet[] = [];
  const stale: string[] = [];
  raws.forEach((r, i) => {
    if (!r) return stale.push(ids[i]);
    try {
      out.push(JSON.parse(r));
    } catch {
      stale.push(ids[i]);
    }
  });
  if (stale.length) await redis(["ZREM", SMART_Z, ...stale]); // detail expired: clean up the index
  return out;
}

/* ---------------- funders ---------------- */

export async function getFunder(address: string): Promise<LeaderboardFunder | null> {
  return hasRedis ? getJson<LeaderboardFunder>(funderKey(address)) : mem.funders.get(address) ?? null;
}

export async function getFunders(addresses: string[]): Promise<Map<string, LeaderboardFunder>> {
  const out = new Map<string, LeaderboardFunder>();
  if (!addresses.length) return out;
  if (!hasRedis) {
    for (const a of addresses) {
      const f = mem.funders.get(a);
      if (f) out.set(a, f);
    }
    return out;
  }
  const raws = (await redis<(string | null)[]>(["MGET", ...addresses.map(funderKey)])) ?? [];
  raws.forEach((r, i) => {
    if (!r) return;
    try {
      out.set(addresses[i], JSON.parse(r));
    } catch {
      /* ignore */
    }
  });
  return out;
}

export async function recordFunding(address: string, label: string | undefined, mint: string, wallets: number, prev?: LeaderboardFunder | null) {
  const before = prev === undefined ? await getFunder(address) : prev;
  const launches = [{ mint, wallets, time: now() }, ...(before?.launches ?? []).filter((l) => l.mint !== mint)].slice(0, MAX_MINTS);
  const entry: LeaderboardFunder = {
    address,
    label,
    launches,
    walletsFunded: launches.reduce((t, l) => t + l.wallets, 0),
    lastSeen: now(),
  };
  if (hasRedis) {
    await Promise.all([
      redis(["SET", funderKey(address), JSON.stringify(entry), "EX", FUNDER_TTL]),
      redis(["ZADD", FUNDERS_Z, launches.length * 1000 + Math.min(999, entry.walletsFunded), address]),
    ]);
  } else {
    mem.funders.set(address, entry);
  }
}

/** Funders ranked by how many launches they've funded early buyers in. Only repeat funders are shown. */
export async function topFunders(limit = 50): Promise<LeaderboardFunder[]> {
  let list: LeaderboardFunder[];
  if (!hasRedis) {
    list = [...mem.funders.values()];
  } else {
    const ids = (await redis<string[]>(["ZRANGE", FUNDERS_Z, 0, limit * 2 - 1, "REV"])) ?? [];
    if (!ids.length) return [];
    const map = await getFunders(ids);
    list = ids.map((id) => map.get(id)).filter((x): x is LeaderboardFunder => !!x);
  }
  return list
    .filter((f) => f.launches.length >= 2)
    .sort((a, b) => b.launches.length - a.launches.length || b.walletsFunded - a.walletsFunded)
    .slice(0, limit);
}

export const registryIsPersistent = () => hasRedis;
