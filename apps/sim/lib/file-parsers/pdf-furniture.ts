/**
 * Detects running headers, footers, and page numbers across a document's pages
 * and removes every copy but the first, so a footer repeated on 140 pages does
 * not land mid-sentence in most retrieval chunks while one copy stays
 * searchable.
 *
 * Only horizontal text takes part: a side-footer printed as rotated text never
 * enters a band because `readItemGeometry` drops rotated items, so it survives
 * on every page. Known limitation.
 */

import type { PdfLine } from '@/lib/file-parsers/pdf-lines'

export interface PdfPageLines {
  lines: PdfLine[]
  /** Page height in PDF user space; absent when the page could not report it. */
  pageHeight?: number
}

/** Fraction of the page height at the top and bottom where furniture lives. */
const FURNITURE_BAND_RATIO = 0.12

/** A page's first or last line counts as a folio candidate only this close to the page edge. */
const EDGE_LINE_RATIO = 0.25

/** Furniture is short; longer repeated band text is a table header or real prose. */
const MAX_FURNITURE_CHARS = 120

/** Lines whose baselines differ by at most this many points share one furniture row. */
const SAME_BASELINE_TOLERANCE = 2

/** Minimum repeats for a key to count as furniture on longer documents. */
const MIN_FURNITURE_REPEATS = 3

/** Fraction of pages a key must cover when it never runs on consecutive pages. */
const FURNITURE_PAGE_FRACTION = 0.5

/** Consecutive-page run that marks furniture even when its total count is modest. */
const MIN_FURNITURE_STREAK = 3

/**
 * A band line whose nearest interior neighbour lies within this many line
 * pitches is part of the text flow — a repeated table header, not furniture
 * separated from the body by a margin gap.
 */
const FLOW_PITCH_RATIO = 1.5

/** Same flow test expressed against the taller of the two lines, for dense tables whose pitch is tiny. */
const FLOW_HEIGHT_RATIO = 2

/** Baseline steps needed before a page's median step is trusted as its line pitch. */
const MIN_PITCH_STEPS = 3

const PAGE_NUMBER_PATTERNS = [
  /^page\s*\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i,
  /^\d{1,4}\s*(of|\/)\s*\d{1,4}$/i,
  /^[-–—]\s*\d+\s*[-–—]$/,
] as const

/** A bare number is a page number only when the document could have that many pages. */
const BARE_NUMBER = /^\d{1,4}$/

/** Strictly formed roman numeral; `mix`, `civil`, or `vivid` never match. */
const ROMAN_NUMERAL = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

const TRAILING_HYPHEN = /\p{L}-$/u

/** Only the tail of a line is tested for a hyphen, keeping the check linear on long lines. */
const HYPHEN_TAIL_CHARS = 2
const LEADING_LOWERCASE = /^\p{Ll}/u

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

type Band = 'top' | 'bottom'

interface BandLine {
  band: Band
  y: number
}

interface BandGroup {
  band: Band
  /** Indices into the page's `lines`. */
  indices: number[]
  text: string
  y: number
  height: number
}

/** One distinct baseline of a page, in geometric order. */
interface Baseline {
  y: number
  height: number
  band: Band | undefined
}

interface KeyOccurrences {
  pages: number[]
  groups: Array<{ page: number; group: BandGroup }>
}

/** Returns each page's lines with repeated furniture and page numbers removed. */
export function suppressFurniture(pages: readonly PdfPageLines[]): PdfLine[][] {
  const drops = pages.map(() => new Set<number>())
  const occurrences = new Map<string, KeyOccurrences>()

  const interiorKeys = collectInteriorKeys(pages)

  pages.forEach((page, pageIndex) => {
    const seen = new Set<string>()
    const baselines = pageBaselines(page)
    const pitch = baselinePitch(baselines)
    for (const index of edgeLineIndices(page)) {
      if (sharesBaseline(page.lines, index)) continue
      const line = page.lines[index]
      if (!isPageNumber(line.text, pages.length)) continue
      const y = line.y as number
      const half: Band = y > (page.pageHeight as number) / 2 ? 'top' : 'bottom'
      const folio = { band: half, indices: [index], text: line.text, y, height: line.height }
      if (isInTextFlow(folio, baselines, pitch)) continue
      drops[pageIndex].add(index)
    }
    for (const group of bandGroups(page)) {
      if (isPageNumber(group.text, pages.length)) {
        for (const index of group.indices) drops[pageIndex].add(index)
        continue
      }
      if (group.text.length > MAX_FURNITURE_CHARS) continue
      const normalized = normalizeFurnitureText(group.text)
      if (normalized.length === 0) continue
      if (interiorKeys.has(normalized)) continue
      if (isHyphenOrphan(page.lines, group)) continue
      if (isInTextFlow(group, baselines, pitch)) continue
      const key = `${group.band}|${normalized}`
      const entry = occurrences.get(key) ?? { pages: [], groups: [] }
      if (!seen.has(key)) {
        seen.add(key)
        entry.pages.push(pageIndex)
      }
      entry.groups.push({ page: pageIndex, group })
      occurrences.set(key, entry)
    }
  })

  const threshold = furnitureThreshold(pages.length)
  for (const entry of occurrences.values()) {
    const count = entry.pages.length
    const byFrequency = threshold !== undefined && count >= threshold
    const byStreak =
      count >= MIN_FURNITURE_REPEATS && longestRun(entry.pages) >= MIN_FURNITURE_STREAK
    if (!byFrequency && !byStreak) continue
    const firstPage = entry.pages[0]
    for (const { page, group } of entry.groups) {
      if (page === firstPage) continue
      for (const index of group.indices) drops[page].add(index)
    }
  }

  return pages.map((page, pageIndex) =>
    drops[pageIndex].size === 0
      ? page.lines
      : page.lines.filter((_, index) => !drops[pageIndex].has(index))
  )
}

/**
 * Lowercases each word, strips its edge punctuation, maps digit runs to `#`, and
 * sorts the words so facing-page footers that mirror their layout (`6 Chapter
 * 1 … Publication 17 (2025)` vs `Publication 17 (2025) Chapter 1 … 7`) share
 * one key.
 */
export function normalizeFurnitureText(text: string): string {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(EDGE_PUNCTUATION, '').replace(/\d+/g, '#'))
    .filter((word) => word.length > 0)
  words.sort()
  return words.join(' ')
}

/**
 * Whether a band line is nothing but a page number. A bare number or roman
 * numeral qualifies only when it does not exceed `pageCount`, so form and
 * publication numbers listed near the page edge survive, and a roman numeral
 * additionally needs a multi-page document.
 */
export function isPageNumber(text: string, pageCount: number): boolean {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (BARE_NUMBER.test(compact)) return Number(compact) <= pageCount
  if (ROMAN_NUMERAL.test(compact)) {
    const value = romanValue(compact)
    return pageCount >= 2 && value >= 1 && value <= pageCount
  }
  return PAGE_NUMBER_PATTERNS.some((pattern) => pattern.test(compact))
}

function romanValue(numeral: string): number {
  let total = 0
  const letters = numeral.toLowerCase()
  for (let i = 0; i < letters.length; i++) {
    const value = ROMAN_VALUES[letters[i]]
    const next = ROMAN_VALUES[letters[i + 1]] ?? 0
    total += value < next ? -value : value
  }
  return total
}

/** Repeat count that marks a key as furniture, or undefined when the document is too short. */
export function furnitureThreshold(pageCount: number): number | undefined {
  if (pageCount < 2) return undefined
  if (pageCount === 2) return 2
  return Math.max(MIN_FURNITURE_REPEATS, Math.ceil(FURNITURE_PAGE_FRACTION * pageCount))
}

/**
 * The first and last non-blank lines of a page when they sit within the outer
 * quarter of the page. A folio printed inside a wide margin sits outside the
 * band, but it is still the edge of the page's text; a table cell mid-page is
 * not.
 */
function edgeLineIndices(page: PdfPageLines): number[] {
  const { pageHeight } = page
  if (pageHeight === undefined || !(pageHeight > 0)) return []
  const indices: number[] = []
  let first = -1
  let last = -1
  page.lines.forEach((line, index) => {
    if (line.text.trim().length === 0) return
    if (first === -1) first = index
    last = index
  })
  const nearEdge = (index: number): boolean => {
    const y = page.lines[index].y
    return (
      y !== undefined &&
      (y <= EDGE_LINE_RATIO * pageHeight || y >= (1 - EDGE_LINE_RATIO) * pageHeight)
    )
  }
  if (first !== -1 && nearEdge(first)) indices.push(first)
  if (last !== -1 && last !== first && nearEdge(last)) indices.push(last)
  return indices
}

/** Groups consecutive band lines that share a baseline into one furniture row. */
function bandGroups(page: PdfPageLines): BandGroup[] {
  const { lines, pageHeight } = page
  if (pageHeight === undefined || !(pageHeight > 0)) return []
  const groups: BandGroup[] = []
  let current: BandGroup | undefined

  lines.forEach((line, index) => {
    const placement = bandOf(line, pageHeight)
    if (!placement) {
      current = undefined
      return
    }
    const { band, y } = placement
    if (current && current.band === band && Math.abs(current.y - y) <= SAME_BASELINE_TOLERANCE) {
      current.indices.push(index)
      current.text = `${current.text} ${line.text.trim()}`
      current.height = Math.max(current.height, line.height)
      return
    }
    current = { band, indices: [index], text: line.text.trim(), y, height: line.height }
    groups.push(current)
  })

  return groups
}

/**
 * Keys of every line outside the bands, so a band line that also occurs in
 * body positions — a table header on a page where the table starts mid-page —
 * is recognised as content rather than furniture.
 */
function collectInteriorKeys(pages: readonly PdfPageLines[]): Set<string> {
  const keys = new Set<string>()
  for (const page of pages) {
    const { pageHeight } = page
    if (pageHeight === undefined || !(pageHeight > 0)) continue
    for (const line of page.lines) {
      if (bandOf(line, pageHeight) !== undefined) continue
      if (line.text.length > MAX_FURNITURE_CHARS) continue
      const key = normalizeFurnitureText(line.text)
      if (key.length > 0) keys.add(key)
    }
  }
  return keys
}

/** A group ending in a hyphen, or continuing a hyphenated word, must not leave an orphan. */
function isHyphenOrphan(lines: readonly PdfLine[], group: BandGroup): boolean {
  if (TRAILING_HYPHEN.test(group.text.slice(-HYPHEN_TAIL_CHARS))) return true
  const previous = lines[group.indices[0] - 1]
  return (
    previous !== undefined &&
    LEADING_LOWERCASE.test(group.text) &&
    TRAILING_HYPHEN.test(previous.text.trimEnd().slice(-HYPHEN_TAIL_CHARS))
  )
}

/** Distinct baselines of a page sorted from top to bottom. */
function pageBaselines(page: PdfPageLines): Baseline[] {
  const { pageHeight } = page
  if (pageHeight === undefined || !(pageHeight > 0)) return []
  const sorted = page.lines
    .filter((line) => line.y !== undefined)
    .map((line) => ({
      y: line.y as number,
      height: line.height,
      band: bandOf(line, pageHeight)?.band,
    }))
    .sort((a, b) => b.y - a.y)
  const baselines: Baseline[] = []
  for (const entry of sorted) {
    const last = baselines[baselines.length - 1]
    if (last && Math.abs(last.y - entry.y) <= SAME_BASELINE_TOLERANCE) {
      last.height = Math.max(last.height, entry.height)
      continue
    }
    baselines.push({ ...entry })
  }
  return baselines
}

/**
 * Lower median of the vertical steps between distinct baselines; 0 when there
 * are fewer than `MIN_PITCH_STEPS`, since on a near-empty page a margin gap is
 * as likely to be the median as a line pitch.
 */
function baselinePitch(baselines: readonly Baseline[]): number {
  const steps: number[] = []
  for (let i = 1; i < baselines.length; i++) steps.push(baselines[i - 1].y - baselines[i].y)
  if (steps.length < MIN_PITCH_STEPS) return 0
  steps.sort((a, b) => a - b)
  return steps[Math.floor((steps.length - 1) / 2)]
}

/**
 * Whether a group reaches an interior line through steps no larger than a line
 * pitch. A running header, footer, or folio is cut off from the body by a
 * margin gap; a repeated table header runs straight into its rows, and a table
 * cell near the page edge sits at the row pitch.
 */
function isInTextFlow(group: BandGroup, baselines: readonly Baseline[], pitch: number): boolean {
  let index = baselines.findIndex((entry) => Math.abs(entry.y - group.y) <= SAME_BASELINE_TOLERANCE)
  if (index === -1) return false
  const step = group.band === 'top' ? 1 : -1
  while (true) {
    const current = baselines[index]
    const next = baselines[index + step]
    if (!next) return false
    const gap = Math.abs(current.y - next.y)
    const limit = Math.max(
      FLOW_PITCH_RATIO * pitch,
      FLOW_HEIGHT_RATIO * Math.max(current.height, next.height)
    )
    if (gap > limit) return false
    if (next.band === undefined) return true
    index += step
  }
}

/** Whether a neighbouring line in reading order shares this line's baseline. */
function sharesBaseline(lines: readonly PdfLine[], index: number): boolean {
  const y = lines[index].y
  if (y === undefined) return false
  return [lines[index - 1], lines[index + 1]].some(
    (neighbour) =>
      neighbour?.y !== undefined && Math.abs(neighbour.y - y) <= SAME_BASELINE_TOLERANCE
  )
}

function bandOf(line: PdfLine, pageHeight: number): BandLine | undefined {
  if (line.y === undefined) return undefined
  if (line.y >= (1 - FURNITURE_BAND_RATIO) * pageHeight) return { band: 'top', y: line.y }
  if (line.y <= FURNITURE_BAND_RATIO * pageHeight) return { band: 'bottom', y: line.y }
  return undefined
}

/** Longest run of consecutive page indices in an ascending list. */
function longestRun(pages: readonly number[]): number {
  let best = 0
  let run = 0
  for (let i = 0; i < pages.length; i++) {
    run = i > 0 && pages[i] === pages[i - 1] + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}
