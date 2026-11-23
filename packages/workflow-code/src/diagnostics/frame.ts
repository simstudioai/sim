import type { BlockKey, SubBlockId } from '../model'
import type { DiagnosticCode } from './codes'
import type { SeverityOf } from './severity'

/**
 * A source range. Lines and columns are 1-based and columns count UTF-16 code units, which is
 * what editors and Babel report (Babel's `loc.column` is 0-based: add 1). `start`/`end` are
 * UTF-16 offsets into the file text, `end` exclusive, as Babel's `node.start`/`node.end`.
 */
export interface SourceSpan {
  /** Repo-relative path of the file the span is in. */
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
  start: number
  end: number
}

/** The fields every finding carries beside its code and severity, in any vocabulary. */
export interface DiagnosticFields {
  message: string
  /** The supported form, or a did-you-mean. */
  hint?: string
  span?: SourceSpan
  /** `codeFrame(text, span)`; present whenever `span` is, unless the code is not `framesSource`. */
  frame?: string
  /** Other locations that explain this one, such as the first declaration for a duplicate name. */
  related?: Array<{ span: SourceSpan; message: string }>
  blockKey?: BlockKey
  /** Set by the apply path once identity is resolved. */
  blockId?: string
  param?: SubBlockId
  /** RFC 6901 JSON Pointer into a non-source input, such as the lock (`/blocks/agent/ident`). */
  path?: string
}

/**
 * One finding. A union over codes, so `severity` always agrees with the code's prefix: an object
 * literal with `code: 'E_SYNTAX'` and `severity: 'warning'` does not type-check.
 */
export type Diagnostic<C extends DiagnosticCode = DiagnosticCode> = C extends DiagnosticCode
  ? DiagnosticFields & { code: C; severity: SeverityOf<C> }
  : never

/** A diagnostic pinned to source, as every compile diagnostic is. */
export type LocatedDiagnostic<C extends DiagnosticCode = DiagnosticCode> = Diagnostic<C> & {
  span: SourceSpan
}

/** Where `codeFrame` points. `endLine`/`endColumn` default to a one-character span. */
interface FrameLocation {
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

/** Babel's line terminators (`lineBreak` in @babel/parser): CRLF, LF, CR, U+2028, U+2029. */
export const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/
const CONTEXT_LINES = 2
/** Code units of a long line a frame shows. */
const FRAME_WIDTH = 160
/** Code units of a long line shown before the column, when the line extends that far left. */
const FRAME_LEAD = 60
const ELLIPSIS = '…'

/** `text` split at Babel's line terminators. */
export function splitLines(text: string): string[] {
  return text.split(LINE_BREAK)
}

/** `value` truncated and clamped; NaN or absent becomes `fallback`, ±Infinity a bound. */
function position(value: number | undefined, fallback: number, min: number, max: number): number {
  const integer = value === undefined || Number.isNaN(value) ? fallback : Math.trunc(value)
  return Math.min(Math.max(integer, min), max)
}

/**
 * Renders a plain-text code frame: the start line of `loc` with two lines of context on each
 * side, `>` on every line inside the span, and a caret row under the start line. Carets run to
 * `endColumn` when the span ends on the start line, else to the end of that line, and never
 * fewer than one. Tabs before the caret are kept so it lines up under tabbed source. A location
 * outside the text, NaN or infinite is clamped, never thrown. No ANSI escapes. A caller framing
 * many locations in one file passes its lines (split as {@link splitLines} does) to split once.
 *
 * A line longer than {@link FRAME_WIDTH} shows only a window of that many code units around the
 * column, the same window on every row, with `…` where text is cut, so a frame's size never
 * depends on line length.
 */
export function codeFrame(text: string | readonly string[], loc: FrameLocation): string {
  const lines = typeof text === 'string' ? splitLines(text) : text
  const line = position(loc.line, 1, 1, lines.length)
  const endLine = position(loc.endLine, line, line, lines.length)
  const source = lines[line - 1]
  const column = position(loc.column, 1, 1, source.length + 1)
  const caretEnd =
    endLine === line
      ? position(loc.endColumn, column + 1, column + 1, source.length + 2)
      : source.length + 1
  const caretCount = Math.max(1, caretEnd - column)

  const first = Math.max(1, line - CONTEXT_LINES)
  const last = Math.min(lines.length, line + CONTEXT_LINES)
  const width = String(last).length
  const blankGutter = ' '.repeat(width)
  const windowStart = Math.max(0, Math.min(column - 1 - FRAME_LEAD, source.length - FRAME_WIDTH))
  const windowEnd = windowStart + FRAME_WIDTH

  const rows: string[] = []
  for (let n = first; n <= last; n++) {
    const content = clip(lines[n - 1], windowStart, windowEnd)
    const marker = n >= line && n <= endLine ? '>' : ' '
    rows.push(`${marker} ${String(n).padStart(width)} |${content ? ` ${content}` : ''}`)
    if (n === line) {
      const cut = windowStart > 0 ? ' ' : ''
      const padding = source.slice(windowStart, column - 1).replace(/[^\t]/g, ' ')
      const shown = Math.min(caretCount, Math.max(1, windowEnd - (column - 1)))
      rows.push(`  ${blankGutter} | ${cut}${padding}${'^'.repeat(shown)}`)
    }
  }
  return rows.join('\n')
}

/** `text[start, end)`, with `…` on each side where text is cut. */
function clip(text: string, start: number, end: number): string {
  if (start === 0 && text.length <= end) return text
  if (start >= text.length) return text.length > 0 ? ELLIPSIS : ''
  return `${start > 0 ? ELLIPSIS : ''}${text.slice(start, end)}${text.length > end ? ELLIPSIS : ''}`
}
