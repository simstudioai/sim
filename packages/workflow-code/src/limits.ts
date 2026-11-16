/**
 * The size limits workflow source shares across reading and writing. A get refuses to print a
 * workflow over them, and compile, the source contracts and the apply body cap enforce the same
 * numbers, so anything a get returns can be applied back unchanged.
 *
 * Files mode never needs more files than blocks: the printer writes at most one code file per
 * block, so `maxFiles` (the entry plus one per block) always holds a workflow within `maxBlocks`,
 * and a get never has to fall back to inline code for an overflow.
 *
 * Client-safe: no parser or catalog imports, so contracts can read it.
 */
export const SOURCE_LIMITS = {
  /** Blocks in one workflow. Mirrors the v2 graph cap (`MAX_WORKFLOW_GRAPH_BLOCKS`). */
  maxBlocks: 2_000,
  /** Files in one source: `workflow.ts` plus one code file per block. */
  maxFiles: 2_001,
  /** UTF-8 bytes of any one file, the entry included. */
  maxFileBytes: 2_000_000,
  /** UTF-8 bytes of every file together. */
  maxTotalBytes: 4_000_000,
} as const

/**
 * Body cap for a request carrying source files: every file at its limit, doubled for JSON string
 * escaping (quotes, backslashes, newlines and tabs each escape to two bytes), plus room for a lock
 * of `maxBlocks` entries.
 */
export const SOURCE_REQUEST_MAX_BYTES = 2 * SOURCE_LIMITS.maxTotalBytes + 2_000_000

/** One limit a source exceeds, with the measured value. */
export interface SourceLimitExcess {
  limit: keyof typeof SOURCE_LIMITS
  actual: number
  max: number
  /** The file, for `maxFileBytes`. */
  file?: string
}

/** UTF-8 length of `text`, counting at most `cap + 1` bytes when a cap is given. */
export function utf8Bytes(text: string, cap = Number.POSITIVE_INFINITY): number {
  let bytes = 0
  for (let i = 0; i < text.length && bytes <= cap; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** Every limit a printed source of `blockCount` blocks exceeds, in limit order; empty when it fits. */
export function sourceLimitExcesses(
  files: Readonly<Record<string, string>>,
  blockCount: number
): SourceLimitExcess[] {
  const excesses: SourceLimitExcess[] = []
  if (blockCount > SOURCE_LIMITS.maxBlocks) {
    excesses.push({ limit: 'maxBlocks', actual: blockCount, max: SOURCE_LIMITS.maxBlocks })
  }
  const paths = Object.keys(files)
  if (paths.length > SOURCE_LIMITS.maxFiles) {
    excesses.push({ limit: 'maxFiles', actual: paths.length, max: SOURCE_LIMITS.maxFiles })
  }
  let total = 0
  for (const path of paths) {
    const bytes = utf8Bytes(files[path])
    total += bytes
    if (bytes > SOURCE_LIMITS.maxFileBytes) {
      excesses.push({
        limit: 'maxFileBytes',
        actual: bytes,
        max: SOURCE_LIMITS.maxFileBytes,
        file: path,
      })
    }
  }
  if (total > SOURCE_LIMITS.maxTotalBytes) {
    excesses.push({ limit: 'maxTotalBytes', actual: total, max: SOURCE_LIMITS.maxTotalBytes })
  }
  return excesses
}
