import { config } from "../config";
import { HttpError } from "../errors";
import { PUMP_DEFAULT_DECIMALS, PUMP_DEFAULT_SUPPLY, TOKEN_PROGRAM } from "../solana/constants";
import { getAsset, getHistory } from "../solana/helius";
import { decodePumpEvents } from "../solana/pump";
import { extractActivities, feePayer, jitoTipSol, sortActivities, tokenProgramFor, txSignature } from "../solana/tx";
import type { RawTx } from "../solana/types";
import type { EarlyBuyer, LaunchAnalysis, Signal, SlotColumn, TokenMeta } from "../types";

const pct = (n: number) => `${n.toFixed(n < 1 ? 2 : 1)}%`;
const sol = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} SOL`;

export async function analyzeLaunch(mint: string): Promise<LaunchAnalysis> {
  const [history, asset] = await Promise.all([
    getHistory(mint, { sortOrder: "asc", limit: config.launchTxLimit, filters: { status: "succeeded" } }),
    getAsset(mint),
  ]);
  const txs = history.data;
  if (!txs.length) {
    throw new HttpError(404, "No transactions found for this address.", "Check the address, or try it as a wallet.");
  }

  // --- creation ---
  let createTx: RawTx | undefined;
  let creator = "";
  let createName: string | undefined;
  let createSymbol: string | undefined;
  for (const tx of txs) {
    const ev = decodePumpEvents(tx).creates.find((c) => c.mint === mint);
    if (ev) {
      createTx = tx;
      creator = ev.creator ?? ev.user;
      createName = ev.name;
      createSymbol = ev.symbol;
      break;
    }
  }
  if (!createTx) {
    createTx = txs[0];
    creator = feePayer(createTx);
  }
  const createSlot = createTx.slot;
  const createTime = createTx.blockTime ?? 0;

  // --- trades ---
  const acts = sortActivities(txs.flatMap((tx) => extractActivities(tx, { mint }))).filter(
    (a) => a.kind === "buy" || a.kind === "sell",
  );
  if (!acts.some((a) => a.venue === "pump")) {
    throw new HttpError(
      404,
      "No pump.fun trades found for this address.",
      "Make sure it's a pump.fun token contract address. If it's a wallet, look it up as a wallet instead.",
    );
  }

  const decimals = asset?.decimals ?? PUMP_DEFAULT_DECIMALS;
  const supply = asset?.supply && asset.supply > 0 ? asset.supply : PUMP_DEFAULT_SUPPLY;
  const meta: TokenMeta = {
    mint,
    name: asset?.name ?? createName,
    symbol: asset?.symbol ?? createSymbol,
    image: asset?.image,
    decimals,
    supply,
    tokenProgram: tokenProgramFor(txs, mint) ?? asset?.tokenProgram ?? TOKEN_PROGRAM,
  };
  const share = (tokens: number) => (tokens / supply) * 100;

  // --- early buyers: first N distinct wallets whose first action is a buy ---
  const buyers = new Map<string, EarlyBuyer>();
  const seen = new Set<string>();
  for (const a of acts) {
    if (!seen.has(a.wallet)) {
      seen.add(a.wallet);
      if (a.kind === "buy" && buyers.size < config.earlyBuyerLimit) {
        buyers.set(a.wallet, {
          wallet: a.wallet,
          rank: buyers.size + 1,
          firstSlot: a.slot,
          slotOffset: a.slot - createSlot,
          firstTime: a.blockTime,
          firstSignature: a.signature,
          sol: 0,
          tokens: 0,
          pctSupply: 0,
          buys: 0,
          isCreator: a.wallet === creator,
          sameSlotAsCreate: a.slot === createSlot,
          jitoTip: 0,
          multiWalletTx: false,
        });
      }
    }
    const b = buyers.get(a.wallet);
    if (b && a.kind === "buy") {
      b.sol += a.sol;
      b.tokens += a.tokens;
      b.buys++;
      b.jitoTip += a.jitoTip;
      b.multiWalletTx ||= a.multiWalletTx;
    }
  }
  const earlyBuyers = [...buyers.values()].map((b) => ({ ...b, pctSupply: share(b.tokens) }));

  // --- dev buy (creator buying inside the create tx) ---
  const createSig = txSignature(createTx);
  const devActs = acts.filter((a) => a.signature === createSig && a.wallet === creator && a.kind === "buy");
  const devTokens = devActs.reduce((t, a) => t + a.tokens, 0);
  const devBuy = devActs.length
    ? { sol: devActs.reduce((t, a) => t + a.sol, 0), tokens: devTokens, pctSupply: share(devTokens) }
    : null;

  // --- slot strip ---
  const slots: SlotColumn[] = [];
  for (let off = 0; off <= config.slotStripWidth; off++) {
    slots.push({ offset: off, slot: createSlot + off, buys: [] });
  }
  for (const a of acts) {
    const off = a.slot - createSlot;
    if (a.kind !== "buy" || off < 0 || off > config.slotStripWidth) continue;
    const col = slots[off];
    if (col.buys.length < 40) col.buys.push({ wallet: a.wallet, sol: a.sol, pctSupply: share(a.tokens), signature: a.signature });
  }

  // --- signals ---
  const signals: Signal[] = [];
  const nonCreator = earlyBuyers.filter((b) => !b.isCreator);

  const sameSlot = nonCreator.filter((b) => b.sameSlotAsCreate);
  if (sameSlot.length) {
    const p = sameSlot.reduce((t, b) => t + b.pctSupply, 0);
    signals.push({
      id: "same-slot",
      severity: sameSlot.length >= 3 || p >= 10 ? "high" : "medium",
      title: `${sameSlot.length} wallet${sameSlot.length > 1 ? "s" : ""} bought in the creation slot`,
      detail: `They took ${pct(p)} of supply in the same block the token was created. Outside wallets almost never land this fast unless the buys were bundled with the deploy.`,
      wallets: sameSlot.map((b) => b.wallet),
    });
  }

  const multi = nonCreator.filter((b) => b.multiWalletTx);
  if (multi.length >= 2) {
    signals.push({
      id: "multi-wallet-tx",
      severity: "high",
      title: "Single transactions bought for several wallets",
      detail: `${multi.length} early wallets received tokens from transactions that bought for more than one wallet at once. That only happens when one operator controls all of them.`,
      wallets: multi.map((b) => b.wallet),
    });
  }

  if (devBuy && devBuy.pctSupply > 0) {
    signals.push({
      id: "dev-buy",
      severity: devBuy.pctSupply >= 10 ? "medium" : devBuy.pctSupply >= 5 ? "low" : "info",
      title: `Creator bought ${pct(devBuy.pctSupply)} at launch`,
      detail: `The deploy transaction included a ${sol(devBuy.sol)} buy by the creator.`,
      wallets: [creator],
    });
  }

  const firstSecond = nonCreator.filter((b) => b.slotOffset <= 2);
  const firstSecondPct = firstSecond.reduce((t, b) => t + b.pctSupply, 0);
  if (firstSecondPct >= 15) {
    signals.push({
      id: "first-second",
      severity: firstSecondPct >= 30 ? "high" : "medium",
      title: `${pct(firstSecondPct)} of supply bought within about a second`,
      detail: `${firstSecond.length} non-creator wallets bought within 2 slots of creation.`,
      wallets: firstSecond.map((b) => b.wallet),
    });
  }

  const bySize = new Map<string, string[]>();
  for (const b of nonCreator) {
    if (b.buys !== 1 || b.sol < 0.05) continue;
    const k = b.sol.toFixed(2);
    bySize.set(k, [...(bySize.get(k) ?? []), b.wallet]);
  }
  for (const [size, wallets] of bySize) {
    if (wallets.length >= 3) {
      signals.push({
        id: `same-size-${size}`,
        severity: wallets.length >= 5 ? "high" : "medium",
        title: `${wallets.length} early wallets bought exactly ${size} SOL`,
        detail: "Identical buy sizes across separate wallets usually mean one script placed them.",
        wallets,
      });
    }
  }

  const tippedCreateSlot = txs.filter((tx) => tx.slot === createSlot && jitoTipSol(tx) > 0).length;
  if (tippedCreateSlot >= 2) {
    signals.push({
      id: "jito",
      severity: "low",
      title: `${tippedCreateSlot} creation-slot transactions paid Jito tips`,
      detail: "Jito tips are how transactions get grouped into an atomic bundle with the deploy.",
    });
  }

  return {
    mint,
    meta,
    creator,
    createSignature: createSig,
    createSlot,
    createTime,
    devBuy,
    earlyBuyers,
    slots,
    signals,
    txsScanned: txs.length,
    windowEndSlot: txs[txs.length - 1].slot,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
