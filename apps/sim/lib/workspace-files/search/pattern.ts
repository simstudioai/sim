import {
  FILE_SEARCH_MAX_QUERY_LENGTH,
  FILE_SEARCH_MIN_QUERY_LENGTH,
} from '@/lib/workspace-files/search/constants'
import { analyzeFileSearchRegex, FileSearchPatternError } from '@/lib/workspace-files/search/regex'

export const FILE_SEARCH_MODES = ['exact', 'regex'] as const
export type FileSearchMode = (typeof FILE_SEARCH_MODES)[number]

export function isFileSearchMode(value: unknown): value is FileSearchMode {
  return FILE_SEARCH_MODES.includes(value as FileSearchMode)
}

export interface FileSearchMatchRange {
  start: number
  end: number
}

/**
 * One query, resolved into everything the rest of the search needs to know about
 * it. Every mode-specific decision — how PostgreSQL matches a segment, whether
 * the segment must be a whole logical line, where the match sits inside it —
 * lives here, so the repository builds one query shape and the preview renderer
 * one preview shape regardless of mode.
 */
export interface CompiledFileSearchPattern {
  mode: FileSearchMode
  /**
   * Smart case, from the pattern's literal characters only. In regex mode the
   * metacharacters are excluded, so `\D` stays case-insensitive the way ripgrep
   * treats it — the uppercase `D` spells a class, it is not text to match.
   */
  caseSensitive: boolean
  /** The operand for `LIKE` / `ILIKE` in exact mode, or `~` / `~*` in regex mode. */
  sqlPattern: string
  /**
   * The exact text every match equals, when there is one. A literal match has a
   * known length and position, which is what lets a caller rank two segments of
   * the same logical line by how much of it surrounds the match; a regex match
   * has neither, so this is `null` in regex mode.
   */
  literalText: string | null
  /**
   * Whether the pattern may only match a segment that holds its whole logical
   * line. `^` and `$` bind to the segment PostgreSQL matches, so on a line long
   * enough to have been split they would anchor mid-line; restricting the match
   * to unsplit lines trades those matches for never reporting a false one.
   */
  wholeLineOnly: boolean
  /** Locates the match inside a segment PostgreSQL already matched. */
  findMatchRange(segment: string): FileSearchMatchRange | null
}

export { FileSearchPatternError } from '@/lib/workspace-files/search/regex'

export function isFileSearchCaseSensitive(text: string): boolean {
  return /\p{Lu}/u.test(text)
}

export function escapeFileSearchLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, '\\$&')
}

/**
 * Maps a match found in the case-folded line back onto the original one.
 * Folding is not length-preserving — `İ` lowercases to two code units — so the
 * folded offsets are walked back through a per-code-point index rather than
 * reused directly.
 */
function findLiteralMatchRange(line: string, query: string, caseSensitive: boolean) {
  if (caseSensitive) {
    const start = Math.max(0, line.indexOf(query))
    return { start, end: Math.min(line.length, start + query.length) }
  }

  const searchableLine = line.toLowerCase()
  const searchableQuery = query.toLowerCase()
  const foldedStart = searchableLine.indexOf(searchableQuery)
  if (foldedStart < 0) return { start: 0, end: Math.min(line.length, query.length) }

  const originalStarts: number[] = []
  const originalEnds: number[] = []
  for (let offset = 0; offset < line.length; ) {
    const codePoint = line.codePointAt(offset)
    if (codePoint === undefined) break
    const character = String.fromCodePoint(codePoint)
    const foldedCharacter = character.toLowerCase()
    const end = offset + character.length
    for (let foldedOffset = 0; foldedOffset < foldedCharacter.length; foldedOffset += 1) {
      originalStarts.push(offset)
      originalEnds.push(end)
    }
    offset = end
  }

  const foldedEnd = foldedStart + searchableQuery.length
  const start = originalStarts[foldedStart] ?? 0
  const end = originalEnds[foldedEnd - 1] ?? Math.min(line.length, start + query.length)
  return { start, end }
}

/** Pulls a range off a surrogate pair, so slicing it never yields a lone half. */
function alignToCodePoints(line: string, range: FileSearchMatchRange): FileSearchMatchRange {
  let { start, end } = range
  const startUnit = line.charCodeAt(start)
  if (start > 0 && startUnit >= 0xdc00 && startUnit <= 0xdfff) start -= 1
  const endUnit = line.charCodeAt(end - 1)
  if (end < line.length && endUnit >= 0xd800 && endUnit <= 0xdbff) end += 1
  return { start, end }
}

function compileExactPattern(query: string): CompiledFileSearchPattern {
  const caseSensitive = isFileSearchCaseSensitive(query)
  return {
    mode: 'exact',
    caseSensitive,
    sqlPattern: `%${escapeFileSearchLikePattern(query)}%`,
    literalText: query,
    wholeLineOnly: false,
    findMatchRange: (segment) => findLiteralMatchRange(segment, query, caseSensitive),
  }
}

function compileRegexPattern(query: string): CompiledFileSearchPattern {
  const analysis = analyzeFileSearchRegex(query)
  if (analysis.longestLiteralRun < FILE_SEARCH_MIN_QUERY_LENGTH) {
    throw new FileSearchPatternError(
      `Search pattern needs at least ${FILE_SEARCH_MIN_QUERY_LENGTH} consecutive literal characters that every match must contain, so the file index can be used — for example "error \\d+" rather than "\\w+ \\d+"`
    )
  }
  const caseSensitive = isFileSearchCaseSensitive(analysis.literals)

  /**
   * The subset is chosen so the same source compiles in both engines, and this
   * is where that holds: PostgreSQL selects the rows, and this expression finds
   * the match inside one to centre the preview on.
   */
  let matcher: RegExp
  try {
    matcher = new RegExp(query, caseSensitive ? '' : 'i')
  } catch (error) {
    throw new FileSearchPatternError(
      `Invalid search pattern: ${error instanceof Error ? error.message : 'could not be compiled'}`
    )
  }

  return {
    mode: 'regex',
    caseSensitive,
    sqlPattern: analysis.postgresSource,
    literalText: null,
    wholeLineOnly: analysis.anchored,
    findMatchRange: (segment) => {
      const match = matcher.exec(segment)
      if (!match) return null
      return alignToCodePoints(segment, {
        start: match.index,
        end: match.index + match[0].length,
      })
    },
  }
}

/**
 * Validates a query and resolves it against its mode. Throws
 * {@link FileSearchPatternError} for anything the caller can fix; the message is
 * written for the caller and is surfaced verbatim.
 */
export function compileFileSearchPattern(
  query: string,
  mode: FileSearchMode
): CompiledFileSearchPattern {
  if (query.length < FILE_SEARCH_MIN_QUERY_LENGTH) {
    throw new FileSearchPatternError(
      `Search query must be at least ${FILE_SEARCH_MIN_QUERY_LENGTH} characters`
    )
  }
  if (query.length > FILE_SEARCH_MAX_QUERY_LENGTH) {
    throw new FileSearchPatternError(
      `Search query must be at most ${FILE_SEARCH_MAX_QUERY_LENGTH} characters`
    )
  }
  if (query.includes('\0')) {
    throw new FileSearchPatternError('Search query cannot contain NUL characters')
  }
  return mode === 'regex' ? compileRegexPattern(query) : compileExactPattern(query)
}
