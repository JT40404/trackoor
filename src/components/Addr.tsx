"use client";

import Link from "next/link";
import { useState } from "react";
import { short, solscanAccount } from "@/lib/format";

export default function Addr({
  address,
  href,
  full = false,
  label,
}: {
  address: string;
  href?: string;
  full?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = label ?? (full ? address : short(address));
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <span className="addr">
      {href ? (
        <Link href={href} className="addr-text" title={address}>
          {text}
        </Link>
      ) : (
        <a href={solscanAccount(address)} target="_blank" rel="noreferrer" className="addr-text" title={address}>
          {text}
        </a>
      )}
      <button type="button" className="addr-copy" onClick={copy} aria-label={`Copy ${address}`}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
