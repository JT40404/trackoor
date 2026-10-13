import { config, heliusUrl } from "../config";
import { HttpError } from "../errors";
import type { HistoryPage, RawTx } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- per-instance concurrency limit ---------- */
let active = 0;
const queue: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= config.heliusConcurrency) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

/* ---------- per-instance requests-per-second limit ---------- */
class Pacer {
  private next = 0;
  constructor(private rps: number) {}
  /** Wait for this request's turn. Requests are spaced evenly at 1/rps seconds. */
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + 1000 / this.rps;
    if (at > now) await sleep(at - now);
  }
  /** After a 429, hold back every queued request, not just the one that failed. */
  pause(ms: number) {
    this.next = Math.max(this.next, Date.now() + ms);
  }
}
const rpcPacer = new Pacer(config.heliusRps);
const dasPacer = new Pacer(config.heliusDasRps);

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
// Helius suggests capping backoff at 30s; serverless functions time out sooner, so cap lower.
const MAX_DELAY_MS = 8000;

class RateLimited extends Error {}

export async function rpc<T>(method: string, params: unknown, kind: "rpc" | "das" = "rpc"): Promise<T> {
  const url = heliusUrl();
  const pacer = kind === "das" ? dasPacer : rpcPacer;
  let delay = 1000;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pacer.take();
    try {
      const res = await withSlot(() =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
          cache: "no-store",
        }),
      );
      lastStatus = res.status;
      if (res.status === 429) throw new RateLimited();
      if (!res.ok) {
        if (RETRYABLE.has(res.status)) throw new Error(`HTTP ${res.status}`);
        throw new HttpError(
          502,
          res.status === 401 || res.status === 403
            ? `Helius rejected the API key (HTTP ${res.status}). Check HELIUS_API_KEY and that your plan includes ${method}.`
            : `Helius returned HTTP ${res.status} for ${method}.`,
        );
      }
      const json = await res.json();
      if (json.error) {
        if (json.error.code === 429 || json.error.code === -32005) throw new RateLimited();
        throw new HttpError(502, `Helius ${method} failed: ${json.error.message ?? "unknown error"}`);
      }
      return json.result as T;
    } catch (err) {
      if (err instanceof HttpError) throw err; // not retryable
      const limited = err instanceof RateLimited;
      if (limited) lastStatus = 429;
      if (attempt === MAX_ATTEMPTS) break;
      const wait = delay * (0.75 + Math.random() * 0.5);
      if (limited) pacer.pause(wait);
      await sleep(wait);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }

  if (lastStatus === 429) {
    throw new HttpError(
      503,
      "The blockchain data provider is busy right now. Try again in a minute.",
      "If this keeps happening, lower HELIUS_RPS or move to a higher Helius plan.",
    );
  }
  throw new HttpError(502, `Couldn't reach Helius for ${method} after ${MAX_ATTEMPTS} attempts.`);
}

export interface HistoryOptions {
  sortOrder?: "asc" | "desc";
  limit?: number;
  maxPages?: number;
  details?: "full" | "signatures";
  filters?: Record<string, unknown>;
}

/** getTransactionsForAddress (Helius-only), following pagination up to maxPages. */
export async function getHistory(address: string, opts: HistoryOptions = {}): Promise<HistoryPage> {
  const { sortOrder = "desc", limit = 100, maxPages = 1, details = "full", filters } = opts;
  const data: RawTx[] = [];
  let token: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result: HistoryPage = await rpc<HistoryPage>("getTransactionsForAddress", [
      address,
      {
        transactionDetails: details,
        sortOrder,
        limit,
        ...(details === "full" ? { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 } : {}),
        ...(filters ? { filters } : {}),
        ...(token ? { paginationToken: token } : {}),
      },
    ]);
    data.push(...(result?.data ?? []));
    token = result?.paginationToken ?? null;
    if (!token || (result?.data?.length ?? 0) < limit) break;
  }
  return { data, paginationToken: token };
}

export interface AssetInfo {
  name?: string;
  symbol?: string;
  image?: string;
  decimals?: number;
  supply?: number; // UI units
  tokenProgram?: string;
}

/** DAS getAsset for name/symbol/image/supply. Never throws. */
export async function getAsset(mint: string): Promise<AssetInfo | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = await rpc("getAsset", { id: mint }, "das");
    if (!a) return null;
    const decimals: number | undefined = a.token_info?.decimals;
    const rawSupply: number | undefined = a.token_info?.supply;
    return {
      name: a.content?.metadata?.name || undefined,
      symbol: a.content?.metadata?.symbol || a.token_info?.symbol || undefined,
      image: a.content?.links?.image || a.content?.files?.[0]?.uri || undefined,
      decimals,
      supply: rawSupply != null && decimals != null ? rawSupply / 10 ** decimals : undefined,
      tokenProgram: a.token_info?.token_program || undefined,
    };
  } catch {
    return null;
  }
}
