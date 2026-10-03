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
  /** The file a hunk belongs to, set only when a git diff spans several files. */
  file?: string
  lines: DiffLine[]
}

export interface UnifiedDiff {
  /** Where the original text lives (`---`). */
  oldSource: DiffSource | null
  /** Where the changed text lives (`+++`); the same resource as `oldSource` for an edit. */
  newSource: DiffSource | null
  /** The file path from a plain `+++ b/<path>` header, for diffs without a `sim:` source. */
  path: string | null
  hunks: DiffHunk[]
}

/** Git metadata that precedes `---`/`+++` in `git diff` output and carries nothing to render. */
const GIT_HEADER =
  /^(?:index |new file mode |deleted file mode |similarity |dissimilarity |rename |copy |old mode |new mode |Binary files )/
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

export function sameSource(a: DiffSource, b: DiffSource): boolean {
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
  let oldSource: DiffSource | null = null
  let newSource: DiffSource | null = null
  const hunks: DiffHunk[] = []
  let hunk: DiffHunk | null = null
  let oldLine: number | undefined
  let newLine: number | undefined

  let file: string | null = null
  let namesPath = false
  /** Each file takes one `---` and one `+++` header; a later line starting that way is a change. */
  let seenOld = false
  let seenNew = false
  for (const [index, row] of rows.entries()) {
    if (row.startsWith('diff --git ')) {
      hunk = null
      file = null
      seenOld = false
      seenNew = false
      continue
    }
    const isOld = row.startsWith('--- ')
    const isNew = row.startsWith('+++ ')
    if (!hunk && ((isOld && !seenOld) || (isNew && !seenNew))) {
      if (isOld) seenOld = true
      else seenNew = true
      const target = row.slice(4).trim()
      const parsed = parseSource(target)
      if (parsed) {
        if (isOld) oldSource = parsed
        else newSource = parsed
      } else if (target !== '/dev/null') {
        namesPath = true
        if (isNew || !file) file = target.replace(/^[ab]\//, '').split('\t')[0]
      }
      continue
    }
    if (!hunk && GIT_HEADER.test(row)) continue
    const header = HUNK_HEADER.exec(row)
    if (row.startsWith('@@') && header) {
      hunk = { heading: header[3] ?? '', file: file ?? undefined, lines: [] }
      hunks.push(hunk)
      oldLine = header[1] ? Number(header[1]) : undefined
      newLine = header[2] ? Number(header[2]) : undefined
      continue
    }
    if (row.startsWith('\\')) continue
    if (!hunk) {
      hunk = { heading: '', file: file ?? undefined, lines: [] }
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
  if (namesPath && (oldSource || newSource))
    throw new Error('A diff with a sim: source cannot also include ordinary file paths')
  oldSource ??= newSource
  newSource ??= oldSource
  const files = new Set(hunks.map((entry) => entry.file))
  const path = files.size > 1 ? `${files.size} files` : (hunks[0]?.file ?? file)
  if (files.size <= 1) for (const entry of hunks) entry.file = undefined
  return { oldSource, newSource, path: oldSource ? null : path, hunks }
}
