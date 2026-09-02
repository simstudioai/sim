export type EditContentFailure =
  | { reason: 'empty_search' }
  | { reason: 'not_found' }
  | { reason: 'ambiguous'; lineNumbers: number[] }
  | { reason: 'invalid_occurrence' }
  | { reason: 'invalid_anchor_order' }

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
 * Replaces the single occurrence of `search`, or refuses.
 *
 * Without an explicit `replaceAll`, refusing more than one match and naming
 * the lines they sit on makes an agent extend its search text rather than
 * gamble. Taking the first match would silently rewrite an arbitrary line.
 */
export function applyStringReplacement(
  text: string,
  search: string,
  content: string,
  replaceAll = false
): string {
  if (search.length === 0) {
    throw new EditContentError('Search text cannot be empty', { reason: 'empty_search' })
  }

  const { count, lineNumbers } = scanMatches(text, search)
  if (count === 0) {
    throw new EditContentError('Search text does not appear in this file', { reason: 'not_found' })
  }
  if (count > 1 && !replaceAll) {
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

  if (replaceAll) return text.split(search).join(content)

  const index = text.indexOf(search)
  return text.slice(0, index) + content + text.slice(index + search.length)
}

/** The line ending the file already uses, so an edit does not leave a mixed one behind. */
export function detectLineEnding(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/)
}

export type WorkspaceFileContentEdit =
  | {
      mode: 'search_replace'
      search: string
      content: string
      replaceAll?: boolean
    }
  | {
      mode: 'replace_between'
      beforeAnchor: string
      afterAnchor: string
      content: string
      occurrence?: number
    }
  | {
      mode: 'insert_after'
      anchor: string
      content: string
      occurrence?: number
    }
  | {
      mode: 'delete_between'
      startAnchor: string
      endAnchor: string
      occurrence?: number
    }

function validateOccurrence(occurrence: number | undefined): number {
  const value = occurrence ?? 1
  if (!Number.isInteger(value) || value < 1) {
    throw new EditContentError('Anchor occurrence must be a whole number, 1 or greater', {
      reason: 'invalid_occurrence',
    })
  }
  return value
}

function anchorLineIndex(lines: string[], anchor: string, occurrence: number): number {
  const normalizedAnchor = anchor.trim()
  if (!normalizedAnchor) {
    throw new EditContentError('Anchor cannot be empty', { reason: 'not_found' })
  }

  let matches = 0
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== normalizedAnchor) continue
    matches++
    if (matches === occurrence) return index
  }

  if (matches === 0) {
    throw new EditContentError(`Anchor line not found: ${JSON.stringify(anchor.slice(0, 100))}`, {
      reason: 'not_found',
    })
  }
  throw new EditContentError(
    `Anchor occurrence ${occurrence} not found; only ${matches} matching line${matches === 1 ? '' : 's'} exist`,
    { reason: 'not_found' }
  )
}

function contentLines(content: string): string[] {
  return content.length === 0 ? [] : splitLines(content)
}

/**
 * Applies one deterministic in-place edit to text.
 *
 * Exact replacement operates on byte-equivalent strings and refuses ambiguity
 * unless `replaceAll` is explicit. Anchored edits match complete trimmed lines,
 * which makes them stable when surrounding line numbers move. Boundary anchors
 * remain in place for replacement and insertion. Deletion matches the
 * `apply_file_edit` protocol: it removes the start anchor and everything before
 * the end anchor, while preserving the end anchor.
 */
export function applyWorkspaceFileContentEdit(
  text: string,
  edit: WorkspaceFileContentEdit
): string {
  if (edit.mode === 'search_replace') {
    return applyStringReplacement(text, edit.search, edit.content, edit.replaceAll)
  }

  const lines = splitLines(text)
  const occurrence = validateOccurrence(edit.occurrence)
  const eol = detectLineEnding(text)

  if (edit.mode === 'insert_after') {
    const anchorIndex = anchorLineIndex(lines, edit.anchor, occurrence)
    return [
      ...lines.slice(0, anchorIndex + 1),
      ...contentLines(edit.content),
      ...lines.slice(anchorIndex + 1),
    ].join(eol)
  }

  const startAnchor = edit.mode === 'replace_between' ? edit.beforeAnchor : edit.startAnchor
  const endAnchor = edit.mode === 'replace_between' ? edit.afterAnchor : edit.endAnchor
  const startIndex = anchorLineIndex(lines, startAnchor, occurrence)
  const endIndex = anchorLineIndex(lines, endAnchor, occurrence)

  if (endIndex <= startIndex) {
    throw new EditContentError(
      `Anchor occurrence ${occurrence} is not ordered: the end anchor must follow the start anchor`,
      { reason: 'invalid_anchor_order' }
    )
  }

  if (edit.mode === 'replace_between') {
    return [
      ...lines.slice(0, startIndex + 1),
      ...contentLines(edit.content),
      ...lines.slice(endIndex),
    ].join(eol)
  }

  return [...lines.slice(0, startIndex), ...lines.slice(endIndex)].join(eol)
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
