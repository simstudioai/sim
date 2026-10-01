/** The fence language that renders a unified diff in markdown; kept apart from the parser. */
export const DIFF_EMBED_LANGUAGE = 'diff'

/** A workspace resource a diff was taken from, named in its `---` / `+++` header lines. */
export type DiffSource =
  | { kind: 'file'; fileId: string }
  | { kind: 'knowledge'; knowledgeBaseId: string; documentId: string }

export interface DiffLine {
  type: 'context' | 'add' | 'del'
  text: string
  /** Line numbers, present only when the hunk header carries them. */
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  /** Free text after the `@@ … @@` range, often the enclosing heading or function. */
  heading: string
  lines: DiffLine[]
}

export interface UnifiedDiff {
  source: DiffSource | null
  /** The file path from a plain `+++ b/<path>` header, for diffs without a `sim:` source. */
  path: string | null
  hunks: DiffHunk[]
}

/**
 * How a diff relates to its source's current text. `current`: every hunk's result is present.
 * `proposed`: every hunk's original is present and none of its results, so the change is not
 * applied. `outdated`: the source no longer matches either side.
 */
export type DiffMatch = 'current' | 'proposed' | 'outdated'

/** Git metadata that precedes `---`/`+++` in `git diff` output and carries nothing to render. */
const GIT_HEADER =
  /^(?:diff --git |index |new file mode |deleted file mode |similarity |rename |old mode |new mode |Binary files )/
const HUNK_HEADER = /^@@(?: -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@)?\s?(.*?)(?:\s*@@)?$/
const SIM_SOURCE = /^sim:(file|knowledge)\/([^/\s]+)(?:\/([^/\s]+))?$/

function parseSource(path: string): DiffSource | null {
  const match = SIM_SOURCE.exec(path.trim().split(/\s/)[0] ?? '')
  if (!match) return null
  const [, kind, first, second] = match
  if (kind === 'file') {
    if (second) throw new Error(`A file source is sim:file/<fileId>, got ${path.trim()}`)
    return { kind: 'file', fileId: first }
  }
  if (!second)
    throw new Error(
      `A knowledge source is sim:knowledge/<knowledgeBaseId>/<documentId>, got ${path}`
    )
  return { kind: 'knowledge', knowledgeBaseId: first, documentId: second }
}

function sameSource(a: DiffSource, b: DiffSource): boolean {
  return a.kind === 'file' && b.kind === 'file'
    ? a.fileId === b.fileId
    : a.kind === 'knowledge' &&
        b.kind === 'knowledge' &&
        a.knowledgeBaseId === b.knowledgeBaseId &&
        a.documentId === b.documentId
}

/**
 * Parses a unified diff. `---`/`+++` paths written as `sim:file/<id>` or
 * `sim:knowledge/<kb>/<doc>` name the source; other paths (`a/src/x.ts`) render without a source.
 * Hunk headers may omit line numbers (`@@ Heading @@`), and a diff with no `@@` is one hunk.
 */
export function parseUnifiedDiff(text: string): UnifiedDiff {
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  let source: DiffSource | null = null
  let path: string | null = null
  const hunks: DiffHunk[] = []
  let hunk: DiffHunk | null = null
  let oldLine: number | undefined
  let newLine: number | undefined

  for (const [index, row] of rows.entries()) {
    if (!hunk && (row.startsWith('--- ') || row.startsWith('+++ '))) {
      const target = row.slice(4).trim()
      const parsed = parseSource(target)
      if (parsed && source && !sameSource(source, parsed))
        throw new Error('A diff compares one source: --- and +++ must name the same resource')
      source = parsed ?? source
      if (!parsed && target !== '/dev/null' && (row.startsWith('+++ ') || !path))
        path = target.replace(/^[ab]\//, '').split('\t')[0]
      continue
    }
    if (!hunk && GIT_HEADER.test(row)) continue
    const header = HUNK_HEADER.exec(row)
    if (row.startsWith('@@') && header) {
      hunk = { heading: header[3] ?? '', lines: [] }
      hunks.push(hunk)
      oldLine = header[1] ? Number(header[1]) : undefined
      newLine = header[2] ? Number(header[2]) : undefined
      continue
    }
    if (row.startsWith('\\')) continue
    if (!hunk) {
      hunk = { heading: '', lines: [] }
      hunks.push(hunk)
    }
    const marker = row[0]
    if (marker !== ' ' && marker !== '+' && marker !== '-' && row !== '')
      throw new Error(`Line ${index + 1}: diff lines start with a space, + or -`)
    const type = marker === '+' ? 'add' : marker === '-' ? 'del' : 'context'
    hunk.lines.push({
      type,
      text: row.slice(1),
      oldLine: type === 'add' ? undefined : oldLine,
      newLine: type === 'del' ? undefined : newLine,
    })
    if (type !== 'add' && oldLine !== undefined) oldLine++
    if (type !== 'del' && newLine !== undefined) newLine++
  }

  if (!hunks.some((entry) => entry.lines.some((line) => line.type !== 'context')))
    throw new Error('A diff needs at least one + or - line')
  return { source, path: source ? null : path, hunks }
}

/** Whitespace-insensitive, so reflowed indentation or line endings never read as a change. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function sideText(hunk: DiffHunk, side: 'before' | 'after'): string {
  const skip = side === 'before' ? 'add' : 'del'
  return normalize(
    hunk.lines
      .filter((line) => line.type !== skip)
      .map((line) => line.text)
      .join('\n')
  )
}

/**
 * Matches each hunk against the source by content rather than line numbers, so edits elsewhere in
 * the source never mark a diff outdated. `segments` are the pieces a source is stored in (a
 * knowledge document's chunks); a hunk may match inside one segment or across their concatenation.
 */
export function matchUnifiedDiff(diff: UnifiedDiff, segments: readonly string[]): DiffMatch {
  const whole = normalize(segments.join('\n'))
  const pieces = segments.map(normalize)
  const contains = (text: string) =>
    text === '' || whole.includes(text) || pieces.some((piece) => piece.includes(text))
  if (diff.hunks.every((hunk) => contains(sideText(hunk, 'after')))) return 'current'
  if (diff.hunks.every((hunk) => contains(sideText(hunk, 'before')))) return 'proposed'
  return 'outdated'
}
