import type { PdfLine } from '@/lib/file-parsers/pdf-lines'

/**
 * Detects running headers, footers, and page numbers across a document's pages
 * and removes every copy but the first, so a footer repeated on 140 pages does
 * not land mid-sentence in most retrieval chunks while one copy stays
 * searchable.
 */

export interface PdfPageLines {
  lines: PdfLine[]
  /** Page height in PDF user space; absent when the page could not report it. */
  pageHeight?: number
}

/** Fraction of the page height at the top and bottom where furniture lives. */
const FURNITURE_BAND_RATIO = 0.12

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

const PAGE_NUMBER_PATTERNS = [
  /^page\s*\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i,
  /^\d{1,4}\s*(of|\/)\s*\d{1,4}$/i,
  /^[ivxlcdm]{1,6}$/i,
  /^[-–—]\s*\d+\s*[-–—]$/,
] as const

/** A bare number is a page number only when the document could have that many pages. */
const BARE_NUMBER = /^\d{1,4}$/

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu

type Band = 'top' | 'bottom'

interface BandGroup {
  band: Band
  /** Indices into the page's `lines`. */
  indices: number[]
  text: string
}

interface KeyOccurrences {
  pages: number[]
  groups: Array<{ page: number; group: BandGroup }>
}

/** Returns each page's lines with repeated furniture and page numbers removed. */
export function suppressFurniture(pages: readonly PdfPageLines[]): PdfLine[][] {
  const drops = pages.map(() => new Set<number>())
  const occurrences = new Map<string, KeyOccurrences>()

  pages.forEach((page, pageIndex) => {
    const seen = new Set<string>()
    for (const index of edgeLineIndices(page)) {
      if (isPageNumber(page.lines[index].text, pages.length)) drops[pageIndex].add(index)
    }
    for (const group of bandGroups(page)) {
      if (isPageNumber(group.text, pages.length)) {
        for (const index of group.indices) drops[pageIndex].add(index)
        continue
      }
      if (group.text.length > MAX_FURNITURE_CHARS) continue
      const key = `${group.band}|${normalizeFurnitureText(group.text)}`
      if (key.endsWith('|')) continue
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
 * Whether a band line is nothing but a page number. A bare number qualifies
 * only when it does not exceed `pageCount`, so form and publication numbers
 * listed near the page edge survive.
 */
export function isPageNumber(text: string, pageCount: number): boolean {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (BARE_NUMBER.test(compact)) return Number(compact) <= pageCount
  return PAGE_NUMBER_PATTERNS.some((pattern) => pattern.test(compact))
}

/** Repeat count that marks a key as furniture, or undefined when the document is too short. */
export function furnitureThreshold(pageCount: number): number | undefined {
  if (pageCount < 2) return undefined
  if (pageCount === 2) return 2
  return Math.max(MIN_FURNITURE_REPEATS, Math.ceil(FURNITURE_PAGE_FRACTION * pageCount))
}

/**
 * The first and last non-blank lines of a page. A folio printed inside a wide
 * margin sits outside the band, but it is still the edge of the page's text.
 */
function edgeLineIndices(page: PdfPageLines): number[] {
  const indices: number[] = []
  let first = -1
  let last = -1
  page.lines.forEach((line, index) => {
    if (line.text.trim().length === 0) return
    if (first === -1) first = index
    last = index
  })
  if (first !== -1) indices.push(first)
  if (last !== -1 && last !== first) indices.push(last)
  return indices
}

/** Groups consecutive band lines that share a baseline into one furniture row. */
function bandGroups(page: PdfPageLines): BandGroup[] {
  const { lines, pageHeight } = page
  if (pageHeight === undefined || !(pageHeight > 0)) return []
  const groups: BandGroup[] = []
  let current: (BandGroup & { y: number }) | undefined

  lines.forEach((line, index) => {
    const band = bandOf(line, pageHeight)
    if (!band) {
      current = undefined
      return
    }
    if (
      current &&
      current.band === band &&
      Math.abs(current.y - (line.y as number)) <= SAME_BASELINE_TOLERANCE
    ) {
      current.indices.push(index)
      current.text = `${current.text} ${line.text.trim()}`
      return
    }
    current = { band, indices: [index], text: line.text.trim(), y: line.y as number }
    groups.push(current)
  })

  return groups
}

function bandOf(line: PdfLine, pageHeight: number): Band | undefined {
  if (line.y === undefined) return undefined
  if (line.y >= (1 - FURNITURE_BAND_RATIO) * pageHeight) return 'top'
  if (line.y <= FURNITURE_BAND_RATIO * pageHeight) return 'bottom'
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
