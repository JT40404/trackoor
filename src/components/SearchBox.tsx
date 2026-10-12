"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import Arrow from "./Arrow";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default function SearchBox({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"token" | "wallet">("token");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!BASE58.test(v)) {
      setError("Enter a Solana address: 32 to 44 characters, no 0, O, I or l.");
      return;
    }
    setError(null);
    router.push(`/${mode}/${v}`);
  }

  return (
    <form className={compact ? "search search-compact" : "search"} onSubmit={submit} role="search">
      {!compact && (
        <div className="search-mode" role="radiogroup" aria-label="Look up">
          {(["token", "wallet"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? "on" : undefined}
              onClick={() => setMode(m)}
            >
              {m === "token" ? "Token" : "Wallet"}
            </button>
          ))}
        </div>
      )}
      <div className="search-row">
        <label htmlFor={id} className="sr-only">
          {mode === "token" ? "Contract address" : "Wallet address"}
        </label>
        <input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={compact ? "Contract address" : mode === "token" ? "Paste a contract address" : "Paste a wallet address"}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <button type="submit" className="btn">
          <span className="btn-label">{compact ? "Check" : mode === "token" ? "Check token" : "Check wallet"}</span>
          <span className="btn-icon">
            <Arrow />
          </span>
        </button>
      </div>
      {error && (
        <p id={`${id}-err`} className="search-error">
          {error}
        </p>
      )}
    </form>
  );
}
