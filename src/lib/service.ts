import "server-only";
import { analyzeLaunch } from "./analysis/launch";
import { analyzeWallet, traderStats, traderStatsFrom } from "./analysis/profile";
import { analyzeSmart } from "./analysis/smart";
import { analyzeEarlyWallets } from "./analysis/wallets";
import { cached } from "./cache";
import { rateLimit } from "./ratelimit";
import { recordTrader, registryIsPersistent, topFunders, topTraders } from "./registry";
import { classifyTrader } from "./smart";
import type { LaunchAnalysis, Leaderboard, TraderStats } from "./types";

const V = "v2"; // bump to invalidate every cached analysis after changing the logic

const now = () => Math.floor(Date.now() / 1000);

/** Launch data is immutable once the launch window has passed, so cache it for a long time. */
export function launchTtl(l: LaunchAnalysis): number {
  const age = now() - l.createTime;
  if (age < 120) return 15;
  if (age < 3600) return 300;
  return 60 * 60 * 24 * 14;
}

export function getLaunch(mint: string, ip: string) {
  return cached(`${V}:launch:${mint}`, () => analyzeLaunch(mint), launchTtl, () => rateLimit(ip));
}

export async function getEarlyWallets(mint: string, ip: string) {
  const { value: launch } = await getLaunch(mint, ip);
  return cached(
    `${V}:wallets:${mint}`,
    () => analyzeEarlyWallets(launch),
    (w) => (w.incompleteWallets > 0 ? 15 : 120), // gaps get retried soon
    () => rateLimit(ip),
  );
}

/** Per-wallet trading stats, cached and shared across every token that wallet shows up in. */
async function statsFor(wallet: string): Promise<TraderStats | null> {
  const { value } = await cached(`${V}:stats:${wallet}`, async () => ({ s: await traderStats(wallet) }), () => 6 * 3600);
  return value.s;
}

export async function getSmart(mint: string, ip: string) {
  const { value: launch } = await getLaunch(mint, ip);
  return cached(
    `${V}:smart:${mint}`,
    () => analyzeSmart(launch, statsFor),
    (s) => (s.incompleteWallets > 0 ? 15 : 1800),
    () => rateLimit(ip),
  );
}

export async function getWalletProfile(wallet: string, ip: string) {
  const res = await cached(`${V}:profile:${wallet}`, () => analyzeWallet(wallet), () => 600, () => rateLimit(ip));
  if (!res.cached) {
    // A full profile is a better sample than the quick one: keep the leaderboard in sync with it.
    const stats = traderStatsFrom(res.value);
    await recordTrader(wallet, classifyTrader(stats), stats).catch(() => {});
  }
  return res;
}

export async function getLeaderboard(): Promise<Leaderboard> {
  const [smart, funders] = await Promise.all([topTraders(50), topFunders(50)]);
  return { smart, funders, persistent: registryIsPersistent(), generatedAt: now() };
}
