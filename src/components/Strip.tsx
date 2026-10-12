"use client";

import { useRef, useState } from "react";
import { fmtPct, fmtSol, short } from "@/lib/format";

export interface StripBuy {
  wallet: string;
  sol: number;
  pctSupply: number;
  signature: string;
}
export interface StripCol {
  offset: number;
  buys: StripBuy[];
}

/**
 * Slot-by-slot launch strip with a drafting-style crosshair that reads out the
 * slot, elapsed time and buys under the pointer.
 */
export default function Strip({
  cols,
  colorFor,
  creator,
  link = true,
  label,
}: {
  cols: StripCol[];
  colorFor: (wallet: string) => string | undefined;
  creator?: string;
  link?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState<{ x: number; y: number; col: number; w: number } | null>(null);

  function move(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const col = Math.min(cols.length - 1, Math.max(0, Math.floor(x / (r.width / cols.length))));
    setCur({ x, y, col, w: r.width });
  }

  const c = cur ? cols[cur.col] : null;
  const pct = c ? c.buys.reduce((t, b) => t + b.pctSupply, 0) : 0;

  return (
    <div className="strip-scroll">
      <div
        className="strip"
        ref={ref}
        onPointerMove={move}
        onPointerLeave={() => setCur(null)}
        role="img"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(44px, 1fr))` }}
      >
        {cols.map((col) => (
          <div key={col.offset} className={col.offset === 0 ? "strip-col strip-create" : "strip-col"}>
            <div className="strip-stack">
              {col.buys.map((b, i) => {
                const style = {
                  height: `${Math.max(5, Math.min(110, Math.sqrt(b.pctSupply) * 15))}px`,
                  background: colorFor(b.wallet),
                };
                const cls = b.wallet === creator ? "strip-block is-creator" : "strip-block";
                const title = `${short(b.wallet)}: ${fmtSol(b.sol)} SOL, ${fmtPct(b.pctSupply)} of supply`;
                return link ? (
                  <a key={`${b.signature}-${i}`} href={`#w-${b.wallet}`} className={cls} style={style} title={title} aria-label={title} />
                ) : (
                  <span key={`${b.signature}-${i}`} className={cls} style={style} />
                );
              })}
            </div>
            <div className="strip-label mono-label">{col.offset === 0 ? "Create" : `+${col.offset}`}</div>
          </div>
        ))}

        {cur && c && (
          <>
            <div className="xh xh-v" style={{ left: cur.x }} aria-hidden />
            <div className="xh xh-h" style={{ top: cur.y }} aria-hidden />
            <div
              className="xh-read mono-label"
              aria-hidden
              style={{
                top: cur.y + 14,
                ...(cur.x > cur.w - 170 ? { right: cur.w - cur.x + 14 } : { left: cur.x + 14 }),
              }}
            >
              <span>Slot: +{c.offset}</span>
              <span>T: +{(c.offset * 0.4).toFixed(1)}s</span>
              <span>Buys: {c.buys.length}</span>
              <span>Supply: {fmtPct(pct)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
