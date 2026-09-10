/**
 * Rebuilds lines and paragraphs from pdf.js text items.
 *
 * pdf.js only flags `hasEOL` when its own heuristics notice a line change; it
 * resets that state when it recurses into a Form XObject and stays silent on a
 * backwards x-move along one baseline, so items glue together without a
 * separator. The builder here derives separators from item geometry instead and
 * keeps each line's baseline and height so paragraph breaks, same-row cells,
 * headings, and running furniture can be recovered afterwards.
 */

/** One text item as pdf.js streams it; every field is untrusted. */
export interface PdfTextItem {
  str?: unknown
  hasEOL?: unknown
  transform?: unknown
  width?: unknown
  height?: unknown
  dir?: unknown
}

/** Horizontal, left-to-right placement of one item in PDF user space. */
export interface PdfItemGeometry {
  x: number
  y: number
  width: number
  height: number
}

/** A reconstructed line of one page. */
export interface PdfLine {
  text: string
  /** Baseline in PDF user space (origin bottom-left); absent when the source carried no geometry. */
  y?: number
  /** Height of the line's dominant item; 0 when unknown. */
  height: number
}

export type PdfLineSeparator = '' | ' ' | '\n'

export interface JoinLinesOptions {
  /** Lowercase `a-b` compounds seen intact in the document; a line break on their hyphen keeps it. */
  compounds?: ReadonlySet<string>
  /** Dominant body-text height for the document; enables heading markers and heading pitch scaling. */
  bodyHeight?: number
  /** Prefixes short, oversized lines with `## ` so Markdown-aware chunkers split on them. */
  headingMarkers?: boolean
}

/** Flip to disable the `## ` heading prefix without touching callers. */
export const PDF_HEADING_MARKERS_ENABLED = true

/** A line at least this many times taller than body text is a heading candidate. */
const HEADING_HEIGHT_RATIO = 1.15

/** Headings are short; longer oversized lines are pull quotes or callouts. */
const HEADING_MAX_CHARS = 120

/** Line gap beyond this multiple of the page's line pitch is a paragraph break. */
const PARAGRAPH_PITCH_RATIO = 1.3

/** Height change between adjacent lines beyond this fraction marks a heading/body boundary. */
const HEIGHT_CHANGE_RATIO = 0.2

/** Lines whose baselines differ by less than this fraction of their height share a row. */
const SAME_ROW_RATIO = 0.3

/** An upward return of at most this many pitches rejoins a wrapped table cell to its row. */
const ROW_RETURN_PITCHES = 3

/** Baseline shift beyond this fraction of the reference height starts a new line. */
const LINE_SHIFT_RATIO = 0.5

/** Backwards x-move beyond this fraction of the reference height starts a new line or cell. */
const BACKWARDS_MOVE_RATIO = 0.5

/** Forward gap beyond this fraction of the reference height is an inter-word space. */
const WORD_GAP_RATIO = 0.1

const SOFT_HYPHEN = '\u00AD'
const TRAILING_HYPHEN = /(\p{L}+)-$/u
const LEADING_LOWERCASE_WORD = /^(\p{Ll}\p{L}*)/u
const INTACT_COMPOUND = /\p{L}+-\p{L}+/gu

/**
 * Reads an item's placement, or undefined when the item is rotated, vertical,
 * right-to-left, or carries no usable transform — those fall back to pdf.js's
 * own `hasEOL` line breaks.
 */
export function readItemGeometry(item: PdfTextItem): PdfItemGeometry | undefined {
  const transform = item.transform
  if (!Array.isArray(transform) || transform.length < 6) return undefined
  const [, skewY, skewX, , x, y] = transform as unknown[]
  if (
    !isFiniteNumber(skewY) ||
    !isFiniteNumber(skewX) ||
    !isFiniteNumber(x) ||
    !isFiniteNumber(y)
  ) {
    return undefined
  }
  if (skewY !== 0 || skewX !== 0) return undefined
  if (item.dir !== undefined && item.dir !== 'ltr') return undefined
  return {
    x,
    y,
    width: isFiniteNumber(item.width) ? item.width : 0,
    height: isFiniteNumber(item.height) ? item.height : 0,
  }
}

/** Accumulates positioned items into lines for one page. */
export class PdfLineBuilder {
  private readonly lines: PdfLine[] = []
  private parts: string[] = []
  private lineY: number | undefined
  private dominantHeight = 0
  private dominantLength = -1
  private prevEndX: number | undefined
  private prevY = 0
  private lineHeight = 0

  /**
   * Separator the geometry rules call for before `str`; '' at line start or
   * when either side lacks geometry.
   */
  separatorBefore(str: string, geometry: PdfItemGeometry | undefined): PdfLineSeparator {
    if (!geometry || this.prevEndX === undefined) return ''
    const height = geometry.height || this.lineHeight
    const ref = Math.max(height, this.lineHeight, 1)
    if (Math.abs(geometry.y - this.prevY) > LINE_SHIFT_RATIO * ref) return '\n'
    const gap = geometry.x - this.prevEndX
    if (gap < -BACKWARDS_MOVE_RATIO * ref) return '\n'
    if (gap > WORD_GAP_RATIO * ref && !this.endsWithWhitespace() && !/^\s/.test(str)) return ' '
    return ''
  }

  append(str: string, geometry?: PdfItemGeometry): void {
    if (str.length > 0) {
      this.parts.push(str)
      const visibleLength = str.trim().length
      if (geometry && visibleLength > this.dominantLength) {
        this.dominantLength = visibleLength
        this.dominantHeight = geometry.height || this.lineHeight
      }
    }
    if (!geometry) return
    if (this.lineY === undefined && str.length > 0) this.lineY = geometry.y
    this.prevEndX = geometry.x + geometry.width
    this.prevY = geometry.y
    this.lineHeight = geometry.height || this.lineHeight
  }

  /** Closes the current line; whitespace-only lines are dropped. */
  endLine(): void {
    const text = this.parts.join('')
    if (text.trim().length > 0) {
      this.lines.push({ text, y: this.lineY, height: this.dominantHeight })
    }
    this.parts = []
    this.lineY = undefined
    this.dominantHeight = 0
    this.dominantLength = -1
    this.prevEndX = undefined
    this.prevY = 0
    this.lineHeight = 0
  }

  finish(): PdfLine[] {
    this.endLine()
    return this.lines
  }

  private endsWithWhitespace(): boolean {
    const last = this.parts[this.parts.length - 1]
    return last !== undefined && /\s$/.test(last)
  }
}

/** Collapses runs of blanks without destroying line and paragraph breaks. */
export function normalizePdfWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** Hyphenated compounds that appear intact inside a line, lowercased. */
export function collectCompounds(lines: Iterable<PdfLine>): Set<string> {
  const compounds = new Set<string>()
  for (const line of lines) {
    for (const match of line.text.matchAll(INTACT_COMPOUND)) compounds.add(match[0].toLowerCase())
  }
  return compounds
}

/** Character-weighted modal line height across the document; 0 when unknown. */
export function dominantLineHeight(lines: Iterable<PdfLine>): number {
  const weights = new Map<number, number>()
  for (const line of lines) {
    if (line.height <= 0) continue
    const key = Math.round(line.height * 10) / 10
    weights.set(key, (weights.get(key) ?? 0) + line.text.trim().length)
  }
  let best = 0
  let bestWeight = 0
  for (const [height, weight] of weights) {
    if (weight > bestWeight) {
      best = height
      bestWeight = weight
    }
  }
  return best
}

/**
 * Joins one page's lines into text with `\n` between lines, `\n\n` between
 * paragraphs, and a space between cells that share a row, dehyphenating words
 * that a line break split.
 */
export function joinLines(lines: readonly PdfLine[], options: JoinLinesOptions = {}): string {
  if (lines.length === 0) return ''
  const pitch = medianPitch(lines)
  const bodyHeight = options.bodyHeight ?? 0
  const headingMarkers = options.headingMarkers ?? PDF_HEADING_MARKERS_ENABLED
  const compounds = options.compounds

  let out = decorate(lines[0], bodyHeight, headingMarkers)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const separator = separatorBetween(lines, i, pitch, bodyHeight)
    if (out.endsWith(SOFT_HYPHEN)) {
      out = out.slice(0, -1) + line.text
      continue
    }
    if (separator === '\n') {
      const joined = dehyphenate(out, line.text, compounds)
      if (joined !== undefined) {
        out = joined
        continue
      }
    }
    out += separator
    out += separator === ' ' ? line.text : decorate(line, bodyHeight, headingMarkers)
  }
  return out
}

function decorate(line: PdfLine, bodyHeight: number, headingMarkers: boolean): string {
  if (
    headingMarkers &&
    bodyHeight > 0 &&
    line.height >= HEADING_HEIGHT_RATIO * bodyHeight &&
    line.text.trim().length < HEADING_MAX_CHARS
  ) {
    return `## ${line.text.trimStart()}`
  }
  return line.text
}

/**
 * Joins `next` onto `out` across a hyphen that ended the line, or undefined
 * when the break is not a hyphenation. A compound seen intact elsewhere in the
 * document keeps its hyphen.
 */
function dehyphenate(
  out: string,
  next: string,
  compounds: ReadonlySet<string> | undefined
): string | undefined {
  const head = TRAILING_HYPHEN.exec(out)
  const tail = LEADING_LOWERCASE_WORD.exec(next)
  if (!head || !tail) return undefined
  const compound = `${head[1]}-${tail[1]}`.toLowerCase()
  if (compounds?.has(compound)) return out + next
  return out.slice(0, -1) + next
}

function separatorBetween(
  lines: readonly PdfLine[],
  index: number,
  pitch: number,
  bodyHeight: number
): ' ' | '\n' | '\n\n' {
  const a = lines[index - 1]
  const b = lines[index]
  if (a.y === undefined || b.y === undefined) return '\n'
  const dy = a.y - b.y
  const maxHeight = Math.max(a.height, b.height)
  if (maxHeight > 0 ? Math.abs(dy) < SAME_ROW_RATIO * maxHeight : dy === 0) return ' '
  if (dy < 0) return isRowReturn(dy, pitch) ? ' ' : '\n\n'
  const next = lines[index + 1]
  if (next?.y !== undefined && isRowReturn(b.y - next.y, pitch)) return ' '
  if (maxHeight > 0 && Math.abs(a.height - b.height) > HEIGHT_CHANGE_RATIO * maxHeight)
    return '\n\n'
  const scale = bodyHeight > 0 ? Math.max(1, maxHeight / bodyHeight) : 1
  if (pitch > 0 && dy > PARAGRAPH_PITCH_RATIO * pitch * scale) return '\n\n'
  return '\n'
}

/** A short upward jump returns to a table row whose earlier cell wrapped onto extra lines. */
function isRowReturn(dy: number, pitch: number): boolean {
  return dy < 0 && pitch > 0 && -dy <= ROW_RETURN_PITCHES * pitch
}

/**
 * Lower median of the downward baseline steps between consecutive lines; 0 when
 * there is none. The lower median keeps a two-step page treating its larger
 * step as the paragraph gap rather than the pitch.
 */
function medianPitch(lines: readonly PdfLine[]): number {
  const steps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1].y
    const b = lines[i].y
    if (a === undefined || b === undefined) continue
    const dy = a - b
    if (dy > 0) steps.push(dy)
  }
  if (steps.length === 0) return 0
  steps.sort((left, right) => left - right)
  return steps[Math.floor((steps.length - 1) / 2)]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
