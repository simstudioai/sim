/**
 * The text transforms behind in-place file editing.
 *
 * Pure and separate from the IO around them because the uniqueness rule is the
 * load-bearing part: an edit that silently picks one of several matches
 * rewrites a line nobody chose, in a file nobody read.
 */

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

/** 1-based line number of a character offset. */
function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

function findOccurrences(text: string, search: string): number[] {
  const indices: number[] = []
  let from = 0
  for (;;) {
    const index = text.indexOf(search, from)
    if (index === -1) return indices
    indices.push(index)
    /* Advance past the match so overlapping text is never counted twice. */
    from = index + search.length
  }
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

  const occurrences = findOccurrences(text, oldString)
  if (occurrences.length === 0) {
    throw new EditContentError('Search text does not appear in this file', { reason: 'not_found' })
  }
  if (occurrences.length > 1) {
    const lineNumbers = occurrences.map((index) => lineNumberAt(text, index))
    throw new EditContentError(
      `Search text appears ${occurrences.length} times, on lines ${lineNumbers.join(', ')}. Include more surrounding text so it matches exactly once.`,
      { reason: 'ambiguous', lineNumbers }
    )
  }

  const index = occurrences[0]
  return text.slice(0, index) + newString + text.slice(index + oldString.length)
}

/** The line ending the file already uses, so an insert does not leave a mixed one behind. */
function detectLineEnding(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/)
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
      lineCount: splitLines(text).length,
    })
  }

  const eol = detectLineEnding(text)
  const lines = splitLines(text)
  /*
   * A file ending in a newline splits to a trailing empty element, which is not
   * a line anyone can insert after. Dropping it keeps `afterLine` counting the
   * lines a reader sees, matching what search and read report.
   */
  const hasTrailingNewline = lines.length > 1 && lines[lines.length - 1] === ''
  const effective = hasTrailingNewline ? lines.slice(0, -1) : lines

  if (afterLine > effective.length) {
    throw new EditContentError(
      `Cannot insert after line ${afterLine}: the file has ${effective.length} lines`,
      { reason: 'line_out_of_range', lineCount: effective.length }
    )
  }

  const inserted = content.split(/\r\n|\n/)
  const next = [...effective.slice(0, afterLine), ...inserted, ...effective.slice(afterLine)]
  return next.join(eol) + (hasTrailingNewline ? eol : '')
}
