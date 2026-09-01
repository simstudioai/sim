/**
 * Returns an L2-normalized copy of a vector, for providers that do not
 * normalize a Matryoshka-reduced output themselves.
 *
 * Gemini does NOT auto-normalize when `outputDimensionality` is set below the
 * native 3072 dimension on `gemini-embedding-001`. Cohere never documents
 * whether it renormalizes a truncated vector, so its reduced output is
 * normalized here too — the operation is idempotent, so it is a no-op on
 * already-unit vectors and a correctness fix otherwise. Both keep cosine and
 * inner-product similarity correct.
 */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector
  return vector.map((v) => v / norm)
}
