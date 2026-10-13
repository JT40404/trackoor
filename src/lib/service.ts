import "server-only";
import { analyzeLaunch } from "./analysis/launch";
import { analyzeWallet } from "./analysis/profile";
import { analyzeEarlyWallets } from "./analysis/wallets";
import { cached } from "./cache";
import { rateLimit } from "./ratelimit";
import type { LaunchAnalysis } from "./types";

const V = "v1"; // bump to invalidate every cached analysis after changing the logic

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

export function getWalletProfile(wallet: string, ip: string) {
  return cached(`${V}:profile:${wallet}`, () => analyzeWallet(wallet), () => 600, () => rateLimit(ip));
}
