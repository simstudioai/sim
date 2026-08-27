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
