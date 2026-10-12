import type { Severity, Signal } from "./types";

const WEIGHT: Record<Severity, number> = { high: 30, medium: 14, low: 5, info: 0 };

export function scoreSignals(signals: Signal[]): { score: number; verdict: string; level: "high" | "medium" | "low" } {
  const score = Math.min(100, signals.reduce((t, s) => t + WEIGHT[s.severity], 0));
  if (score >= 60) return { score, level: "high", verdict: "Strong signs of a bundled launch" };
  if (score >= 25) return { score, level: "medium", verdict: "Some signs of coordinated early buying" };
  return { score, level: "low", verdict: "No strong bundling signals in the launch window" };
}

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
export const sortSignals = (list: Signal[]) => [...list].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
