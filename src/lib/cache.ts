/**
 * Two-tier cache:
 *  - Upstash Redis (REST) when configured: shared across all serverless instances.
 *  - In-memory fallback: per instance, fine for local dev and low traffic.
 * Concurrent requests for the same key on one instance share a single computation.
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const hasRedis = Boolean(REDIS_URL && REDIS_TOKEN);

export async function redis<T = unknown>(command: (string | number)[]): Promise<T | null> {
  if (!hasRedis) return null;
  try {
    const res = await fetch(REDIS_URL!, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.result ?? null) as T | null;
  } catch {
    return null; // cache is best-effort; never fail a request because of it
  }
}

const memory = new Map<string, { value: unknown; expires: number }>();
const MEMORY_MAX = 300;

async function get<T>(key: string): Promise<T | null> {
  if (hasRedis) {
    const raw = await redis<string>(["GET", key]);
    if (raw) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value as T;
}

async function set(key: string, value: unknown, ttlSec: number): Promise<void> {
  if (ttlSec <= 0) return;
  if (hasRedis) {
    await redis(["SET", key, JSON.stringify(value), "EX", Math.round(ttlSec)]);
    return;
  }
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}

const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  ttl: (value: T) => number,
  onMiss?: () => Promise<void>,
): Promise<{ value: T; cached: boolean }> {
  const hit = await get<T>(key);
  if (hit) return { value: hit, cached: true };

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, cached: false };

  if (onMiss) await onMiss();
  const p = compute();
  inflight.set(key, p);
  try {
    const value = await p;
    await set(key, value, ttl(value));
    return { value, cached: false };
  } finally {
    inflight.delete(key);
  }
}
