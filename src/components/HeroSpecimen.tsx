"use client";

import Frame from "./Frame";
import SevMark from "./SevMark";
import Strip, { type StripCol } from "./Strip";

// Illustrative launch, not real data.
const b = (wallet: string, pctSupply: number) => ({ wallet, pctSupply, sol: pctSupply * 0.32, signature: wallet });
const COLS: StripCol[] = [
  { offset: 0, buys: [b("dev", 6.2), b("a1", 3.1), b("a2", 3.0), b("a3", 2.9), b("x1", 1.1)] },
  { offset: 1, buys: [b("b1", 2.4), b("x2", 0.8)] },
  { offset: 2, buys: [b("b2", 1.7), b("x3", 0.5)] },
  { offset: 3, buys: [b("x4", 0.9)] },
  { offset: 4, buys: [] },
  { offset: 5, buys: [b("x5", 0.6), b("x6", 0.3)] },
  { offset: 6, buys: [b("x7", 0.4)] },
  { offset: 7, buys: [b("x8", 0.7)] },
  { offset: 8, buys: [] },
  { offset: 9, buys: [b("x9", 0.5)] },
];
const color = (w: string) =>
  w === "dev" ? "var(--brand)" : w.startsWith("a") ? "var(--c0)" : w.startsWith("b") ? "var(--c1)" : undefined;

export default function HeroSpecimen() {
  return (
    <Frame className="specimen">
      <div className="specimen-head">
        <span className="mono-label">Example launch</span>
        <span className="mono-label muted hover-only">Hover to read slots</span>
      </div>
      <Strip cols={COLS} colorFor={color} creator="dev" link={false} label="Example launch strip with a bundled creation slot" />
      <div className="specimen-callout">
        <SevMark severity="high" />
        <div>
          <span className="mono-label">Sig-01</span>
          <p>3 wallets bought in the creation slot, all funded from one address.</p>
        </div>
      </div>
    </Frame>
  );
}
