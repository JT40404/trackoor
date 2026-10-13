import { JITO_TIP_ACCOUNTS, LAMPORTS_PER_SOL, PUMP_DEFAULT_DECIMALS, WSOL_MINT } from "./constants";
import { decodePumpEvents } from "./pump";
import type { RawTx } from "./types";

export type ActivityKind = "buy" | "sell" | "transfer_in" | "transfer_out";

export interface Activity {
  signature: string;
  slot: number;
  txIndex: number;
  order: number; // position inside the transaction
  blockTime: number;
  wallet: string;
  mint: string;
  kind: ActivityKind;
  tokens: number; // UI units
  sol: number; // SOL spent (buy) or received (sell); 0 for transfers
  venue: "pump" | "other" | "transfer";
  jitoTip: number; // SOL tipped to Jito in this tx (only set for the fee payer)
  multiWalletTx: boolean; // this tx bought/sold for more than one wallet on the same mint
  counterparty?: string; // for transfers: the other owner, when identifiable
}

/**
 * A swap on a non-pump venue is inferred from token + SOL balance changes. Anything
 * smaller than this is treated as rent/fees, not a trade (ATA rent is ~0.00204 SOL).
 */
const MIN_SWAP_LAMPORTS = 3_000_000n;

interface Key {
  pubkey: string;
  signer: boolean;
}

export function accountKeys(tx: RawTx): Key[] {
  const msg = tx.transaction?.message;
  const raw: unknown[] = msg?.accountKeys ?? [];
  const nSigners: number = msg?.header?.numRequiredSignatures ?? 1;
  const keys: Key[] = raw.map((k, i) =>
    typeof k === "string"
      ? { pubkey: k, signer: i < nSigners }
      : { pubkey: (k as { pubkey: string }).pubkey, signer: !!(k as { signer?: boolean }).signer },
  );
  const loaded = tx.meta?.loadedAddresses;
  const nBalances = tx.meta?.preBalances?.length ?? 0;
  if (loaded && keys.length < nBalances) {
    for (const k of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) keys.push({ pubkey: k, signer: false });
  }
  return keys;
}

export const txSignature = (tx: RawTx): string => tx.transaction?.signatures?.[0] ?? "";
export const feePayer = (tx: RawTx): string => accountKeys(tx)[0]?.pubkey ?? "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function allInstructions(tx: RawTx): any[] {
  const outer = tx.transaction?.message?.instructions ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((g: any) => g.instructions ?? []);
  return [...outer, ...inner];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function systemTransfer(ix: any): { source: string; destination: string; lamports: number } | null {
  if (ix?.program !== "system") return null;
  const t = ix.parsed?.type;
  if (t !== "transfer" && t !== "transferWithSeed") return null;
  const info = ix.parsed.info ?? {};
  if (!info.destination || typeof info.lamports !== "number") return null;
  return { source: info.source, destination: info.destination, lamports: info.lamports };
}

export function jitoTipSol(tx: RawTx): number {
  let lamports = 0;
  for (const ix of allInstructions(tx)) {
    const t = systemTransfer(ix);
    if (t && JITO_TIP_ACCOUNTS.has(t.destination)) lamports += t.lamports;
  }
  return lamports / LAMPORTS_PER_SOL;
}

/** Incoming SOL transfers to `wallet` in this tx (system program transfers only). */
export function solInflows(tx: RawTx, wallet: string): { source: string; lamports: number }[] {
  if (tx.meta?.err) return [];
  const out: { source: string; lamports: number }[] = [];
  for (const ix of allInstructions(tx)) {
    const t = systemTransfer(ix);
    if (t && t.destination === wallet && t.source && t.source !== wallet) out.push({ source: t.source, lamports: t.lamports });
  }
  return out;
}

/** Outgoing SOL transfers from `wallet` in this tx (system program transfers only, Jito tips excluded). */
export function solOutflows(tx: RawTx, wallet: string): { destination: string; lamports: number }[] {
  if (tx.meta?.err) return [];
  const out: { destination: string; lamports: number }[] = [];
  for (const ix of allInstructions(tx)) {
    const t = systemTransfer(ix);
    if (t && t.source === wallet && t.destination !== wallet && !JITO_TIP_ACCOUNTS.has(t.destination)) {
      out.push({ destination: t.destination, lamports: t.lamports });
    }
  }
  return out;
}

interface TokenBal {
  owner: string;
  mint: string;
  amount: bigint;
  decimals: number;
}

/** owner -> mint -> raw delta, plus decimals per mint. */
export function tokenDeltas(tx: RawTx): { deltas: Map<string, Map<string, bigint>>; decimals: Map<string, number> } {
  const pre = new Map<number, TokenBal>();
  const post = new Map<number, TokenBal>();
  const decimals = new Map<string, number>();
  const read = (list: unknown, into: Map<number, TokenBal>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const b of (list as any[]) ?? []) {
      if (!b?.owner || !b?.mint) continue;
      const dec = b.uiTokenAmount?.decimals ?? PUMP_DEFAULT_DECIMALS;
      decimals.set(b.mint, dec);
      into.set(b.accountIndex, { owner: b.owner, mint: b.mint, amount: BigInt(b.uiTokenAmount?.amount ?? "0"), decimals: dec });
    }
  };
  read(tx.meta?.preTokenBalances, pre);
  read(tx.meta?.postTokenBalances, post);

  const deltas = new Map<string, Map<string, bigint>>();
  for (const idx of new Set([...pre.keys(), ...post.keys()])) {
    const a = pre.get(idx);
    const b = post.get(idx);
    const ref = b ?? a!;
    const d = (b?.amount ?? 0n) - (a?.amount ?? 0n);
    if (d === 0n) continue;
    const m = deltas.get(ref.owner) ?? new Map<string, bigint>();
    m.set(ref.mint, (m.get(ref.mint) ?? 0n) + d);
    deltas.set(ref.owner, m);
  }
  return { deltas, decimals };
}

/** Net SOL change for `owner` in lamports, including wrapped SOL, excluding the tx fee. */
function solDeltaLamports(tx: RawTx, keys: Key[], owner: string, deltas: Map<string, Map<string, bigint>>): bigint {
  const idx = keys.findIndex((k) => k.pubkey === owner);
  let d = 0n;
  if (idx >= 0) {
    const pre = BigInt(tx.meta?.preBalances?.[idx] ?? 0);
    const post = BigInt(tx.meta?.postBalances?.[idx] ?? 0);
    d = post - pre;
    if (idx === 0) d += BigInt(tx.meta?.fee ?? 0);
  }
  d += deltas.get(owner)?.get(WSOL_MINT) ?? 0n;
  return d;
}

const toUi = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

export interface ExtractOptions {
  /** Only activities for this wallet. When omitted, pump trades for everyone + inferred swaps for signers. */
  wallet?: string;
  /** Only activities for this mint. */
  mint?: string;
  /** Emit transfer_in / transfer_out for token movements that aren't trades. */
  includeTransfers?: boolean;
}

export function extractActivities(tx: RawTx, opts: ExtractOptions = {}): Activity[] {
  if (!tx.meta || tx.meta.err) return [];
  const keys = accountKeys(tx);
  const signers = new Set(keys.filter((k) => k.signer).map((k) => k.pubkey));
  const payer = keys[0]?.pubkey;
  const tip = jitoTipSol(tx);
  const base = {
    signature: txSignature(tx),
    slot: tx.slot,
    txIndex: tx.transactionIndex ?? 0,
    blockTime: tx.blockTime ?? 0,
  };
  const { trades } = decodePumpEvents(tx);
  const { deltas, decimals } = tokenDeltas(tx);

  const out: Activity[] = [];
  let order = 0;
  const explained = new Map<string, bigint>();
  const pumpUsers = new Set<string>();

  const usersPerMint = new Map<string, Set<string>>();
  for (const t of trades) {
    const s = usersPerMint.get(t.mint) ?? new Set<string>();
    s.add(t.user);
    usersPerMint.set(t.mint, s);
  }

  for (const t of trades) {
    pumpUsers.add(t.user);
    const k = `${t.user}|${t.mint}`;
    explained.set(k, (explained.get(k) ?? 0n) + (t.isBuy ? t.tokenAmount : -t.tokenAmount));
    if (opts.mint && t.mint !== opts.mint) continue;
    if (opts.wallet && t.user !== opts.wallet) continue;
    out.push({
      ...base,
      order: order++,
      wallet: t.user,
      mint: t.mint,
      kind: t.isBuy ? "buy" : "sell",
      tokens: toUi(t.tokenAmount, decimals.get(t.mint) ?? PUMP_DEFAULT_DECIMALS),
      sol: Number(t.solAmount) / LAMPORTS_PER_SOL,
      venue: "pump",
      jitoTip: t.user === payer ? tip : 0,
      multiWalletTx: (usersPerMint.get(t.mint)?.size ?? 0) > 1,
    });
  }

  const owners = opts.wallet ? [opts.wallet] : [...signers];
  for (const owner of owners) {
    const m = deltas.get(owner);
    if (!m) continue;
    for (const [mint, delta] of m) {
      if (mint === WSOL_MINT) continue;
      if (opts.mint && mint !== opts.mint) continue;
      const residual = delta - (explained.get(`${owner}|${mint}`) ?? 0n);
      if (residual === 0n) continue;
      const dec = decimals.get(mint) ?? PUMP_DEFAULT_DECIMALS;
      const abs = residual < 0n ? -residual : residual;

      if (!pumpUsers.has(owner) && signers.has(owner)) {
        const solD = solDeltaLamports(tx, keys, owner, deltas);
        if (residual > 0n && solD < -MIN_SWAP_LAMPORTS) {
          out.push({ ...base, order: order++, wallet: owner, mint, kind: "buy", tokens: toUi(abs, dec), sol: Number(-solD) / LAMPORTS_PER_SOL, venue: "other", jitoTip: owner === payer ? tip : 0, multiWalletTx: false });
          continue;
        }
        if (residual < 0n && solD > MIN_SWAP_LAMPORTS) {
          out.push({ ...base, order: order++, wallet: owner, mint, kind: "sell", tokens: toUi(abs, dec), sol: Number(solD) / LAMPORTS_PER_SOL, venue: "other", jitoTip: owner === payer ? tip : 0, multiWalletTx: false });
          continue;
        }
      }
      if (!opts.includeTransfers) continue;

      // Find the other side of the transfer: the owner whose balance of this mint moved the opposite way.
      let counterparty: string | undefined;
      let best = 0n;
      for (const [other, om] of deltas) {
        if (other === owner) continue;
        const od = om.get(mint) ?? 0n;
        if ((residual > 0n && od < 0n) || (residual < 0n && od > 0n)) {
          const a = od < 0n ? -od : od;
          if (a > best) {
            best = a;
            counterparty = other;
          }
        }
      }
      out.push({
        ...base,
        order: order++,
        wallet: owner,
        mint,
        kind: residual > 0n ? "transfer_in" : "transfer_out",
        tokens: toUi(abs, dec),
        sol: 0,
        venue: "transfer",
        jitoTip: 0,
        multiWalletTx: false,
        counterparty,
      });
    }
  }
  return out;
}

export function sortActivities(list: Activity[]): Activity[] {
  return list.sort((a, b) => a.slot - b.slot || a.txIndex - b.txIndex || a.order - b.order);
}

/** Token program for `mint`, read from token balance metadata. */
export function tokenProgramFor(txs: RawTx[], mint: string): string | undefined {
  for (const tx of txs) {
    for (const b of [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])]) {
      if (b?.mint === mint && b.programId) return b.programId as string;
    }
  }
  return undefined;
}
