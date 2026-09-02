/**
 * Reciprocal-rank-fusion damping constant, shared by fusion and the recency
 * boost so a rank means the same to both: `score = 1 / (RRF_K + rank)`. 60 is
 * the value from the original RRF paper and matches the docs search retriever
 * (`apps/docs/app/api/search/route.ts`).
 */
export const RRF_K = 60
