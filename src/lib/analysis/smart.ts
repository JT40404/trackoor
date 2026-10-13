import { recordTrader } from "../registry";
import { classifyTrader } from "../smart";
import type { LaunchAnalysis, SmartAnalysis, SmartWallet, TraderStats } from "../types";

/**
 * Rate each early buyer from their recent trading history.
 * `statsFor` is injected so per-wallet stats can be cached and shared across tokens.
 */
export async function analyzeSmart(
  launch: LaunchAnalysis,
  statsFor: (wallet: string) => Promise<TraderStats | null>,
): Promise<SmartAnalysis> {
  let lastError: unknown = null;
  const wallets: SmartWallet[] = await Promise.all(
    launch.earlyBuyers.map(async (b) => {
      try {
        const stats = await statsFor(b.wallet);
        return { wallet: b.wallet, stats, rating: classifyTrader(stats) };
      } catch (e) {
        lastError = e;
        return { wallet: b.wallet, stats: null, rating: classifyTrader(null), incomplete: true };
      }
    }),
  );
  const incompleteWallets = wallets.filter((w) => w.incomplete).length;
  if (wallets.length && incompleteWallets === wallets.length && lastError) throw lastError;

  await Promise.all(
    wallets
      .filter((w) => w.stats && !w.incomplete)
      .map((w) => recordTrader(w.wallet, w.rating, w.stats!, launch.mint).catch(() => {})),
  );

  return { mint: launch.mint, wallets, incompleteWallets, generatedAt: Math.floor(Date.now() / 1000) };
}
