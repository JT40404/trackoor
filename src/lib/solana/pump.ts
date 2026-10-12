import bs58 from "bs58";
import { createHash } from "crypto";
import { PUMP_PROGRAM } from "./constants";
import type { RawTx } from "./types";

/**
 * pump.fun is an Anchor program. It emits TradeEvent / CreateEvent both as
 * "Program data:" log lines and as self-CPI event instructions. We read both,
 * scoped to the pump.fun program so other programs' events can't collide.
 */

const disc = (name: string) => createHash("sha256").update(name).digest().subarray(0, 8);
const TRADE_DISC = disc("event:TradeEvent"); // bddb7fd34ee661ee
const CREATE_DISC = disc("event:CreateEvent");
const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex"); // Anchor emit_cpi! prefix

export interface PumpTrade {
  mint: string;
  solAmount: bigint; // lamports
  tokenAmount: bigint; // raw units
  isBuy: boolean;
  user: string;
  timestamp: number;
}

export interface PumpCreate {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string;
  creator?: string;
}

class Reader {
  private o = 0;
  constructor(private b: Buffer) {}
  skip(n: number) {
    this.o += n;
  }
  pubkey(): string {
    const s = bs58.encode(this.b.subarray(this.o, this.o + 32));
    this.o += 32;
    return s;
  }
  u64(): bigint {
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64(): bigint {
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
  u8(): number {
    return this.b[this.o++];
  }
  str(): string {
    const len = this.b.readUInt32LE(this.o);
    this.o += 4;
    if (len > 1024) throw new Error("bad string");
    const s = this.b.subarray(this.o, this.o + len).toString("utf8");
    this.o += len;
    return s;
  }
  remaining() {
    return this.b.length - this.o;
  }
}

function decodeTrade(buf: Buffer): PumpTrade | null {
  if (buf.length < 8 + 32 + 8 + 8 + 1 + 32 + 8) return null;
  try {
    const r = new Reader(buf);
    r.skip(8);
    const mint = r.pubkey();
    const solAmount = r.u64();
    const tokenAmount = r.u64();
    const isBuy = r.u8() === 1;
    const user = r.pubkey();
    const timestamp = Number(r.i64());
    return { mint, solAmount, tokenAmount, isBuy, user, timestamp };
  } catch {
    return null;
  }
}

function decodeCreate(buf: Buffer): PumpCreate | null {
  try {
    const r = new Reader(buf);
    r.skip(8);
    const name = r.str();
    const symbol = r.str();
    const uri = r.str();
    const mint = r.pubkey();
    const bondingCurve = r.pubkey();
    const user = r.pubkey();
    const creator = r.remaining() >= 32 ? r.pubkey() : undefined;
    return { name, symbol, uri, mint, bondingCurve, user, creator };
  } catch {
    return null;
  }
}

function classify(buf: Buffer, trades: PumpTrade[], creates: PumpCreate[]) {
  if (buf.length < 8) return;
  const head = buf.subarray(0, 8);
  if (head.equals(TRADE_DISC)) {
    const t = decodeTrade(buf);
    if (t) trades.push(t);
  } else if (head.equals(CREATE_DISC)) {
    const c = decodeCreate(buf);
    if (c) creates.push(c);
  }
}

const cache = new WeakMap<RawTx, { trades: PumpTrade[]; creates: PumpCreate[] }>();

export function decodePumpEvents(tx: RawTx): { trades: PumpTrade[]; creates: PumpCreate[] } {
  const hit = cache.get(tx);
  if (hit) return hit;

  // 1) self-CPI event instructions
  const cpiTrades: PumpTrade[] = [];
  const cpiCreates: PumpCreate[] = [];
  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions ?? []) {
      if (ix.programId !== PUMP_PROGRAM || typeof ix.data !== "string") continue;
      let data: Buffer;
      try {
        data = Buffer.from(bs58.decode(ix.data));
      } catch {
        continue;
      }
      if (data.length > 16 && data.subarray(0, 8).equals(EVENT_IX_TAG)) {
        classify(data.subarray(8), cpiTrades, cpiCreates);
      }
    }
  }

  // 2) "Program data:" logs, only while pump.fun is the executing program
  const logTrades: PumpTrade[] = [];
  const logCreates: PumpCreate[] = [];
  const stack: string[] = [];
  for (const line of (tx.meta?.logMessages ?? []) as string[]) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === PUMP_PROGRAM) {
      try {
        classify(Buffer.from(line.slice(14), "base64"), logTrades, logCreates);
      } catch {
        /* ignore */
      }
    }
  }

  // Same events can appear in both places; prefer whichever source saw more.
  const result = {
    trades: cpiTrades.length >= logTrades.length ? cpiTrades : logTrades,
    creates: cpiCreates.length >= logCreates.length ? cpiCreates : logCreates,
  };
  cache.set(tx, result);
  return result;
}
