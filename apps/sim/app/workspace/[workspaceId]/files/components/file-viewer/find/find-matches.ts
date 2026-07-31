import type { FindFlags } from './types'

/** Escapes a literal string so it can be embedded in a `RegExp` source. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds the `RegExp` for a find query under the active flags, or `null` when the query is empty
 * or (in regex mode) not a valid pattern. Always global so every match is found; case-insensitive
 * unless `caseSensitive`; whole-word wraps the pattern in ASCII word boundaries. In literal mode the
 * query is escaped first, so regex metacharacters match literally.
 */
export function buildFindRegex(query: string, flags: FindFlags): RegExp | null {
  if (!query) return null

  const body = flags.regex ? query : escapeRegExp(query)
  const source = flags.wholeWord ? `\\b(?:${body})\\b` : body
  const modifiers = `g${flags.caseSensitive ? '' : 'i'}`

  try {
    return new RegExp(source, modifiers)
  } catch {
    return null
  }
}

export interface FindRange {
  /** Inclusive start offset into the searched text. */
  start: number
  /** Exclusive end offset into the searched text. */
  end: number
  /** The full match followed by any capture groups (`groups[0]` is the whole match). */
  groups: (string | undefined)[]
}

/**
 * Returns every non-overlapping match of `regex` in `text`. `regex` must be global. Zero-length
 * matches (e.g. `a*` against `bbb`) are skipped and the scan advances one character so it can never
 * loop forever. Pass `limit` to cap the number of ranges collected while still scanning for a total
 * (see {@link findMatches}).
 */
export function findRanges(
  text: string,
  regex: RegExp,
  limit = Number.POSITIVE_INFINITY
): FindRange[] {
  const ranges: FindRange[] = []
  regex.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    if (ranges.length < limit) {
      ranges.push({ start: match.index, end: match.index + match[0].length, groups: [...match] })
    } else {
      // Past the highlight cap — stop collecting ranges but keep scanning for the total count.
      break
    }
  }

  return ranges
}

export interface FindMatches {
  ranges: FindRange[]
  /** Total match count, which may exceed `ranges.length` when the highlight cap is hit. */
  total: number
  /** True when `total` exceeds `ranges.length` (the cap dropped some highlights). */
  capped: boolean
}

/**
 * Finds matches with a highlight cap: collects up to `limit` ranges for rendering while counting the
 * true `total`. Beyond the cap, counting continues without allocating ranges, so a pathological query
 * on a huge document never builds millions of decoration objects.
 */
export function findMatches(text: string, regex: RegExp, limit = 5000): FindMatches {
  const ranges: FindRange[] = []
  regex.lastIndex = 0
  let total = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    total += 1
    if (ranges.length < limit) {
      ranges.push({ start: match.index, end: match.index + match[0].length, groups: [...match] })
    }
  }

  return { ranges, total, capped: total > ranges.length }
}
