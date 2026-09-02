/**
 * Reciprocal-rank-fusion damping constant, shared by fusion and the recency
 * boost so a rank means the same to both: `score = 1 / (RRF_K + rank)`. 60 is
 * the value from the original RRF paper and matches the docs search retriever
 * (`apps/docs/app/api/search/route.ts`).
 */
export const RRF_K = 60

/** Age at which a document's recency boost has decayed to half. */
export const RECENCY_HALF_LIFE_DAYS = 90
/** The most a fully fresh document's rank score is raised, as a fraction. */
export const RECENCY_WEIGHT = 0.05

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How fresh a document is on a 0..1 scale: 1 when modified now, halving every
 * {@link RECENCY_HALF_LIFE_DAYS}. A document whose source reports no modified
 * time, or one dated in the future, gets no boost at all.
 */
export function recencyFreshness(sourceModifiedAt: Date | null | undefined, now: Date): number {
  if (!sourceModifiedAt) return 0
  const ageMs = now.getTime() - sourceModifiedAt.getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0
  return 2 ** (-ageMs / (RECENCY_HALF_LIFE_DAYS * DAY_MS))
}

/**
 * Reorders relevance-ranked rows so a recently modified document edges past a
 * stale one of similar relevance. The boost works on rank, not on the legs'
 * incomparable raw scores, and it is bounded by {@link RECENCY_WEIGHT}: a
 * fresh document can climb a handful of places, never from the bottom to the
 * top. Rows without a source modified time keep their exact rank order.
 */
export function applyRecencyBoost<T extends { sourceModifiedAt: Date | null }>(
  rows: readonly T[],
  now: Date = new Date()
): T[] {
  const boosted = rows.map((row, index) => ({
    row,
    score:
      (1 / (RRF_K + index + 1)) *
      (1 + RECENCY_WEIGHT * recencyFreshness(row.sourceModifiedAt, now)),
  }))
  return boosted.sort((a, b) => b.score - a.score).map((entry) => entry.row)
}
