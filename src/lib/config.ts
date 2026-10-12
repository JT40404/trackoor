import { HttpError } from "./errors";

function num(value: string | undefined, fallback: number, max = Infinity): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

export const config = {
  /** How many of the earliest transactions on the mint to pull for launch analysis (max 1000). */
  launchTxLimit: num(process.env.LAUNCH_TX_LIMIT, 300, 1000),
  /** How many distinct early buyers to profile (funding, positions). Each costs ~3 RPC calls. */
  earlyBuyerLimit: num(process.env.EARLY_BUYER_LIMIT, 30, 100),
  /** Max simultaneous Helius requests per serverless instance. */
  heliusConcurrency: num(process.env.HELIUS_CONCURRENCY, 8, 50),
  /** Fresh analyses (cache misses) allowed per IP per minute. */
  rateLimitPerMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 20),

  /** Transactions to scan backwards from launch when looking for a wallet's funder. */
  fundingLookback: 40,
  /** Ignore incoming SOL transfers smaller than this when tracing funders. */
  minFundingLamports: 10_000_000, // 0.01 SOL
  /** Pages/page size when pulling a wallet's history for one token. */
  positionPageSize: 200,
  positionMaxPages: 3,
  /** Pages/page size for the cross-token wallet profile. */
  profilePageSize: 250,
  profileMaxPages: 2,
  /** Launch-strip width in slots after creation. */
  slotStripWidth: 12,
};

export function heliusUrl(): string {
  if (process.env.HELIUS_RPC_URL) return process.env.HELIUS_RPC_URL;
  const key = process.env.HELIUS_API_KEY;
  if (!key) {
    throw new HttpError(500, "Server is missing HELIUS_API_KEY. Add it in your Vercel project settings.");
  }
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}
