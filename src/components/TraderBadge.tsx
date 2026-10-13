import { TRADER_LABELS } from "@/lib/smart";
import type { TraderRating } from "@/lib/types";

export default function TraderBadge({ rating, showScore = true }: { rating: TraderRating; showScore?: boolean }) {
  return (
    <span className={`trader trader-${rating.label}`} title={rating.reasons.join(". ")}>
      {TRADER_LABELS[rating.label]}
      {showScore && rating.score !== null && <span className="trader-score">{rating.score}</span>}
    </span>
  );
}
