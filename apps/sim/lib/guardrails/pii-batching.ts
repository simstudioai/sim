/**
 * Per-request bounds shared by both Presidio hops: the app→route HTTP call
 * (`mask-client`) and the route→sidecar call (`validate_pii`). Keeping a single
 * source of truth ensures every request stays far under the 10MB Next body limit
 * and small enough for one short spaCy NER pass under the sidecar timeout.
 */

/** Max UTF-8 bytes of text per Presidio request. ~40× under the 10MB Next limit. */
export const PII_REQUEST_MAX_BYTES = 256 * 1024
/** Max strings per request; caps per-item overhead and stays well under the contract's 100k-entry cap. */
export const PII_REQUEST_MAX_COUNT = 2_000

/**
 * Group `texts` into chunks of original indices, flushing a chunk when adding the
 * next string would exceed {@link PII_REQUEST_MAX_BYTES} or {@link PII_REQUEST_MAX_COUNT}.
 * A single string larger than the byte budget still gets its own chunk — strings
 * are never dropped, since an unredacted leaf would persist PII. Order is preserved
 * across and within chunks.
 */
export function chunkIndicesByBudget(texts: string[]): number[][] {
  const chunks: number[][] = []
  let current: number[] = []
  let bytes = 0

  for (let i = 0; i < texts.length; i++) {
    const size = Buffer.byteLength(texts[i], 'utf8')
    if (
      current.length > 0 &&
      (current.length >= PII_REQUEST_MAX_COUNT || bytes + size > PII_REQUEST_MAX_BYTES)
    ) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(i)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)

  return chunks
}
