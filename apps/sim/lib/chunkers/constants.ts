/**
 * Bounds on the separator list a recursive chunking config may carry.
 *
 * `RecursiveChunker` scans the whole document once per separator and walks the
 * list from the top for every oversized fragment, so the separator count is a
 * direct multiplier on synchronous CPU per document. The work happens inside a
 * split loop, which neither the processing `Promise.race` timeout nor the
 * after-the-fact chunk-count cap can interrupt — the list has to be bounded on
 * the way in instead.
 *
 * The largest built-in recipe (`markdown`) uses 16 separators, so 32 leaves room
 * for a hand-tuned list without letting one config stall the processing tier.
 */
export const MAX_CHUNKING_SEPARATORS = 32

/** Max characters in a single chunking separator. Real delimiters are a few characters. */
export const MAX_CHUNKING_SEPARATOR_LENGTH = 100

/**
 * Width of Sim's own documentation index (`docs_embeddings`), which is a single
 * fixed-width pgvector column independent of the `EMBEDDING_OUTPUT_DIMS` a
 * deployment chooses for its knowledge bases. Both the indexer and the docs
 * search path pin this, so a deployment configured for another width cannot
 * write vectors the docs column will not accept or query it at the wrong width.
 */
export const DOCS_EMBEDDING_DIMENSIONS = 1536 as const
