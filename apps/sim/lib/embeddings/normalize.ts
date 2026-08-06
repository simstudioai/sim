/**
 * L2-normalizes a vector in place of the provider doing it.
 *
 * Gemini does NOT auto-normalize embeddings when `outputDimensionality` is set
 * below the native 3072 dimension on `gemini-embedding-001`. Normalizing
 * manually keeps cosine and inner-product similarity correct.
 */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0
  for (const v of vector) sumSquares += v * v
  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector
  return vector.map((v) => v / norm)
}
