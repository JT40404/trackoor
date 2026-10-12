import type { Severity } from "@/lib/types";

/** Square marker: filled with an X for high, outlined for medium/low, dashed for notes. */
export default function SevMark({ severity }: { severity: Severity }) {
  return (
    <span className={`sev-mark sev-mark-${severity}`} aria-hidden>
      {severity === "high" && (
        <svg viewBox="0 0 10 10" width="10" height="10">
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </span>
  );
}
