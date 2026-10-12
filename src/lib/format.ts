export const short = (a: string, n = 4) => (a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export function fmtSol(n: number | null | undefined, signed = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${s}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (n === 0) return "0%";
  if (n < 0.01) return "<0.01%";
  return `${n.toFixed(n < 1 ? 2 : 1)}%`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "–";
  if (sec < 1) return "<1s";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h`;
  return `${(sec / 86400).toFixed(sec < 864000 ? 1 : 0)}d`;
}

export function fmtAgo(unix: number | null | undefined): string {
  if (!unix) return "–";
  return `${fmtDuration(Date.now() / 1000 - unix)} ago`;
}

export function fmtDate(unix: number | null | undefined): string {
  if (!unix) return "–";
  return new Date(unix * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (a: string) => `https://solscan.io/account/${a}`;
