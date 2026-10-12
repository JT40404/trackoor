import { config, heliusUrl } from "../config";
import { HttpError } from "../errors";
import type { HistoryPage, RawTx } from "./types";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rpc<T>(method: string, params: unknown): Promise<T> {
  const url = heliusUrl();
  for (let attempt = 0; ; attempt++) {
    const res = await withSlot(() =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
        cache: "no-store",
      }),
    );
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(300 * 2 ** attempt + Math.random() * 200);
      continue;
    }
    if (!res.ok) throw new HttpError(502, `Helius returned HTTP ${res.status} for ${method}.`);
    const json = await res.json();
    if (json.error) {
      if (json.error.code === 429 && attempt < 4) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new HttpError(502, `Helius ${method} failed: ${json.error.message ?? "unknown error"}`);
    }
    return json.result as T;
  }
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
    const a: any = await rpc("getAsset", { id: mint });
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
