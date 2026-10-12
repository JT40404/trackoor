import { config } from "./config";
import { HttpError } from "./errors";
import { hasRedis, redis } from "./cache";

const memory = new Map<string, { count: number; reset: number }>();

/** Fixed one-minute window per IP. Only applied to cache misses (fresh analyses). */
export async function rateLimit(ip: string): Promise<void> {
  const limit = config.rateLimitPerMinute;
  const windowId = Math.floor(Date.now() / 60_000);
  const key = `rl:${ip}:${windowId}`;
  let count: number;
  if (hasRedis) {
    count = (await redis<number>(["INCR", key])) ?? 0;
    if (count === 1) await redis(["EXPIRE", key, 70]);
  } else {
    const now = Date.now();
    const e = memory.get(key);
    if (!e || e.reset < now) {
      memory.set(key, { count: 1, reset: now + 60_000 });
      count = 1;
    } else count = ++e.count;
    if (memory.size > 5000) memory.clear();
  }
  if (count > limit) {
    throw new HttpError(429, "Too many new lookups from your network. Wait a minute and try again.");
  }
}
