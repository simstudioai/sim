export type EditContentFailure =
  | { reason: 'empty_search' }
  | { reason: 'not_found' }
  | { reason: 'ambiguous'; lineNumbers: number[] }
  | { reason: 'line_out_of_range'; lineCount: number }

export class EditContentError extends Error {
  constructor(
    message: string,
    readonly failure: EditContentFailure
  ) {
    super(message)
    this.name = 'EditContentError'
  }
}

/**
 * How many matches an ambiguity error names before it stops counting.
 *
 * A short search string in a large file can match thousands of times. Listing
 * every line builds an error message far larger than the file itself, and the
 * caller only needs enough examples to see the match is not unique.
 */
const MAX_REPORTED_MATCHES = 10

interface MatchScan {
  count: number
  /** Line numbers of the first {@link MAX_REPORTED_MATCHES} matches, 1-based. */
  lineNumbers: number[]
}

/**
 * Locates every occurrence and its line number in one pass over the text.
 *
 * One pass rather than a scan per match: counting newlines from the start for
 * each hit is quadratic, so a short search string in a large file turned an
 * ambiguity report into a stall.
 */
function scanMatches(text: string, search: string): MatchScan {
  const lineNumbers: number[] = []
  let count = 0
  let line = 1
  let cursor = 0
  let from = 0

  for (;;) {
    const index = text.indexOf(search, from)
    if (index === -1) break
    count++
    if (lineNumbers.length < MAX_REPORTED_MATCHES) {
      for (; cursor < index; cursor++) {
        if (text.charCodeAt(cursor) === 10) line++
      }
      lineNumbers.push(line)
    }
    /* Advance past the match so overlapping text is never counted twice. */
    from = index + search.length
  }

  return { count, lineNumbers }
}

/**
 * Replaces the single occurrence of `oldString`, or refuses.
 *
 * Refusing on more than one match, and naming the lines they sit on, is what
 * makes an agent extend its search text rather than gamble. Both of the
 * alternatives silently corrupt: taking the first match rewrites an arbitrary
 * line, and replacing all of them rewrites lines the caller never saw.
 */
export function applyStringReplacement(text: string, oldString: string, newString: string): string {
  if (oldString.length === 0) {
    throw new EditContentError('Search text cannot be empty', { reason: 'empty_search' })
  }

  const { count, lineNumbers } = scanMatches(text, oldString)
  if (count === 0) {
    throw new EditContentError('Search text does not appear in this file', { reason: 'not_found' })
  }
  if (count > 1) {
    const shown = lineNumbers.join(', ')
    const where =
      count > lineNumbers.length
        ? `first on lines ${shown}, and ${count - lineNumbers.length} more`
        : `on lines ${shown}`
    throw new EditContentError(
      `Search text appears ${count} times, ${where}. Include more surrounding text so it matches exactly once.`,
      { reason: 'ambiguous', lineNumbers }
    )
  }

  const index = text.indexOf(oldString)
  return text.slice(0, index) + newString + text.slice(index + oldString.length)
}

/** The line ending the file already uses, so an edit does not leave a mixed one behind. */
export function detectLineEnding(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/)
}

/**
 * The lines a reader sees.
 *
 * Text ending in a newline splits to a trailing empty element that is not a
 * line anyone can point at. Every surface that reports or accepts a line number
 * counts through here, so `insert` accepts exactly the range that `search`,
 * a ranged read, and the count returned after an edit all describe.
 */
export function countLines(text: string): number {
  return visibleLines(text).length
}

function visibleLines(text: string): string[] {
  const lines = splitLines(text)
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/**
 * Inserts `content` after the 1-based `afterLine`; `0` puts it at the top.
 *
 * A line past the end is refused rather than clamped. Clamping turns an
 * off-by-one into a silent write to the wrong end of the file, which is
 * exactly the class of mistake an unattended agent makes and cannot see.
 */
export function applyLineInsertion(text: string, afterLine: number, content: string): string {
  if (!Number.isInteger(afterLine) || afterLine < 0) {
    throw new EditContentError('afterLine must be a whole number, 0 or greater', {
      reason: 'line_out_of_range',
      lineCount: countLines(text),
    })
  }

  const eol = detectLineEnding(text)
  const effective = visibleLines(text)
  const hasTrailingNewline = effective.length !== splitLines(text).length

  if (afterLine > effective.length) {
    throw new EditContentError(
      `Cannot insert after line ${afterLine}: the file has ${effective.length} lines`,
      { reason: 'line_out_of_range', lineCount: effective.length }
    )
  }

  const inserted = visibleLines(content)
  const next = [...effective.slice(0, afterLine), ...inserted, ...effective.slice(afterLine)]
  return next.join(eol) + (hasTrailingNewline ? eol : '')
}
