/**
 * Reads side-by-side blocks one at a time when pdf.js streams them interleaved.
 *
 * pdf.js streams text in content-stream (draw) order, which is the right
 * reading order for almost every page. It fails when a page places independent
 * grids next to each other — calendar months, account boxes — and the
 * producer draws one row across every block before the next: the text comes
 * out as `Su Mo … Sa Su Mo … Sa` then `1 2 3 1 2 3 4 …`, and no cell can be tied
 * back to its block. This module finds bands of rows that a wide vertical
 * gutter divides into grids cut from one template (same header row, same width
 * and inner columns), and only when the stream crosses those gutters row after row does it
 * emit each block top to bottom instead. Tables, prose, and everything else
 * keep stream order.
 */

import { type PdfItemGeometry, type PdfLine, PdfLineBuilder } from '@/lib/file-parsers/pdf-lines'

/**
 * Ceiling on buffered items per page. Layout analysis needs a whole page in
 * hand; past this the page streams straight into the line builder in pdf.js
 * order, so a pathological page costs no more than it did before.
 */
export const MAX_PDF_LAYOUT_ITEMS = 20_000

/** Ceiling on distinct x-intervals tracked per band; past it the page keeps stream order. */
const MAX_BAND_INTERVALS = 256

/** Items whose baselines differ by at most this fraction of their height share a row. */
const ROW_TOLERANCE_RATIO = 0.5

/** A gutter must be at least this many body heights wide. */
const GUTTER_MIN_RATIO = 1.5

/** A gutter must be at least this many times wider than any column gap inside the blocks it divides. */
const GUTTER_DOMINANCE_RATIO = 2

/** A vertical gap inside a block at least this many body heights wide makes it a grid. */
const GRID_GAP_RATIO = 0.5

/** A block needs at least this many rows to stand on its own. */
const MIN_BLOCK_ROWS = 2

/**
 * A plain column — a legend or sidebar — may stand apart from the blocks when
 * it fills at most this share of the band's rows.
 */
const SPARSE_BLOCK_ROW_FRACTION = 0.5

/** Blocks from one template differ in width by at most this fraction. */
const CONGRUENT_WIDTH_RATIO = 0.1

/** A block's shared header row must sit within this many rows of its top. */
const HEADER_SEARCH_ROWS = 3

const LETTER = /\p{L}/u

/** A vertical step beyond this many row pitches ends a band, so stacked rows of blocks read in order. */
const BAND_BREAK_PITCHES = 2

export interface BufferedItem {
  str: string
  geometry: PdfItemGeometry | undefined
  hasEOL: boolean
}

interface LayoutItem {
  /** Position in the page's stream. */
  index: number
  str: string
  geometry: PdfItemGeometry
}

interface LayoutRow {
  y: number
  items: LayoutItem[]
}

/** A closed x-interval `[start, end]` in PDF user space. */
type Interval = [number, number]

/** A band whose blocks are read one at a time, spliced in where its stream span began. */
export interface ReorderedBand {
  /** Blocks left to right, each a list of rows top to bottom. */
  blocks: LayoutRow[][]
  /** Stream index of the band's last item. */
  last: number
}

/**
 * Collects one page's text items and turns them into lines. Buffers up to
 * `MAX_PDF_LAYOUT_ITEMS` so interleaved blocks can be detected; past that it
 * replays the buffer and streams the rest in pdf.js order.
 */
export class PdfPageCollector {
  private readonly builder = new PdfLineBuilder()
  private buffer: BufferedItem[] | undefined = []

  add(str: string, geometry: PdfItemGeometry | undefined, hasEOL: boolean): void {
    if (this.buffer) {
      this.buffer.push({ str, geometry, hasEOL })
      if (this.buffer.length <= MAX_PDF_LAYOUT_ITEMS) return
      const buffered = this.buffer
      this.buffer = undefined
      for (const entry of buffered) this.stream(entry)
      return
    }
    this.stream({ str, geometry, hasEOL })
  }

  finish(): PdfLine[] {
    const buffered = this.buffer
    this.buffer = undefined
    if (buffered) this.replay(buffered, findInterleavedBands(buffered))
    return this.builder.finish()
  }

  /**
   * Streams the page, emitting each reordered band block by block at the point
   * its first item was drawn. Whitespace and line-break items inside a band's
   * stream span belong to the order being replaced, so they are skipped.
   */
  private replay(entries: readonly BufferedItem[], bands: readonly ReorderedBand[]): void {
    const bandAt = new Map<number, ReorderedBand>()
    for (const band of bands) {
      for (const block of band.blocks) {
        for (const row of block) for (const item of row.items) bandAt.set(item.index, band)
      }
    }
    const emitted = new Set<ReorderedBand>()
    let open: ReorderedBand | undefined
    for (const [index, entry] of entries.entries()) {
      const band = bandAt.get(index)
      if (band) {
        if (!emitted.has(band)) {
          emitted.add(band)
          for (const block of band.blocks) this.emitBlock(block)
          this.builder.startBlock()
        }
        open = band
        continue
      }
      if (open && index > open.last) open = undefined
      if (open && entry.str.trim().length === 0) continue
      this.stream(entry)
    }
  }

  /** Feeds one item in stream order, deriving separators from geometry and pdf.js's `hasEOL`. */
  private stream({ str, geometry, hasEOL }: BufferedItem): void {
    const separator = str.length > 0 ? this.builder.separatorBefore(str, geometry) : ''
    if (separator === '\n') this.builder.endLine()
    else if (separator.length > 0) this.builder.append(separator)
    this.builder.append(str, geometry)
    if (hasEOL) this.builder.endLine()
  }

  /** Emits a block's rows as lines; the block's first line starts a new paragraph. */
  private emitBlock(rows: readonly LayoutRow[]): void {
    this.builder.startBlock()
    for (const row of rows) {
      for (const item of row.items) {
        /** Items of one row never split it: an overlapping item only needs a space. */
        if (this.builder.separatorBefore(item.str, item.geometry).length > 0) {
          this.builder.append(' ')
        }
        this.builder.append(item.str, item.geometry)
      }
      this.builder.endLine()
    }
  }
}

/**
 * Bands of the page whose side-by-side blocks the stream interleaves, in page
 * order. Empty when geometry is missing or unusable, or when every band is
 * already streamed block by block — the caller then keeps pdf.js's order.
 */
export function findInterleavedBands(entries: readonly BufferedItem[]): ReorderedBand[] {
  const items: LayoutItem[] = []
  for (const [index, entry] of entries.entries()) {
    if (entry.str.trim().length === 0) continue
    /** One unplaceable item means the page's geometry cannot be trusted as a whole. */
    if (!entry.geometry) return []
    items.push({ index, str: entry.str, geometry: entry.geometry })
  }
  if (items.length === 0) return []

  const bodyHeight = medianHeight(items)
  if (bodyHeight <= 0) return []

  const rows = groupRows(items, bodyHeight)
  const minGutter = GUTTER_MIN_RATIO * bodyHeight
  const maxStep =
    BAND_BREAK_PITCHES *
    rowPitch(rows.filter((row) => widestGap(rowIntervals(row, minGutter)) >= minGutter))
  const bands: ReorderedBand[] = []
  let start = 0
  while (start < rows.length) {
    const band = growBand(rows, start, bodyHeight, maxStep)
    if (band === undefined) return []
    const blocks = band.rows.length >= MIN_BLOCK_ROWS ? splitBand(band, bodyHeight) : undefined
    if (blocks && isInterleaved(blocks)) bands.push(spanOf(blocks))
    start += band.rows.length
  }
  return bands
}

interface Band {
  rows: LayoutRow[]
  /** Coalesced x-extent of the band's items, left to right. */
  intervals: Interval[]
}

/**
 * Extends a band from `start` while the rows' combined x-extent keeps at least
 * one gutter-wide gap and no vertical step exceeds `maxStep`. Undefined when
 * the band's interval count exceeds the cap.
 */
function growBand(
  rows: readonly LayoutRow[],
  start: number,
  bodyHeight: number,
  maxStep: number
): Band | undefined {
  const minGutter = GUTTER_MIN_RATIO * bodyHeight
  let intervals = rowIntervals(rows[start], minGutter)
  let end = start + 1
  if (widestGap(intervals) < minGutter) return { rows: rows.slice(start, end), intervals }
  while (end < rows.length) {
    if (maxStep > 0 && rows[end - 1].y - rows[end].y > maxStep) break
    const merged = mergeIntervals(intervals, rowIntervals(rows[end], minGutter), minGutter)
    if (merged.length > MAX_BAND_INTERVALS) return undefined
    if (widestGap(merged) < minGutter) break
    intervals = merged
    end++
  }
  return { rows: rows.slice(start, end), intervals }
}

/**
 * Splits a band at its dominant gutters, or undefined unless the pieces are
 * independent grids cut from one template: each repeats the same header row and
 * has the same width and inner columns. A column of plain cells may stand
 * apart only when it is sparse, like a legend; one that spans the band labels
 * every row, so the band is a table and is left alone.
 */
function splitBand(band: Band, bodyHeight: number): LayoutRow[][] | undefined {
  const minGutter = GUTTER_MIN_RATIO * bodyHeight
  const { intervals } = band
  const widest = widestGap(intervals)
  if (widest < minGutter) return undefined

  /** Blocks are the runs of intervals between gaps at least half the widest one. */
  const threshold = Math.max(minGutter, widest / GUTTER_DOMINANCE_RATIO)
  const groups: Interval[][] = [[intervals[0]]]
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i][0] - intervals[i - 1][1] >= threshold) groups.push([])
    groups[groups.length - 1].push(intervals[i])
  }
  if (groups.length < 2) return undefined

  const gutterStarts = groups.slice(1).map((_, i) => groups[i][groups[i].length - 1][1])
  const narrowestGutter = Math.min(
    ...groups.slice(1).map((group, i) => group[0][0] - gutterStarts[i])
  )

  const blocks: LayoutRow[][] = groups.map(() => [])
  for (const row of band.rows) {
    const parts: LayoutItem[][] = groups.map(() => [])
    for (const item of row.items) parts[blockIndex(item.geometry.x, gutterStarts)].push(item)
    parts.forEach((items, i) => {
      if (items.length > 0) blocks[i].push({ y: row.y, items })
    })
  }

  const minGridGap = GRID_GAP_RATIO * bodyHeight
  const gridBlocks: LayoutRow[][] = []
  const grids: Interval[][] = []
  for (const rows of blocks) {
    const grid = gridSignature(rows, minGridGap)
    if (!grid) {
      if (rows.length > SPARSE_BLOCK_ROW_FRACTION * band.rows.length) return undefined
      continue
    }
    if (narrowestGutter < GUTTER_DOMINANCE_RATIO * widestGap(grid)) return undefined
    gridBlocks.push(rows)
    grids.push(grid)
  }
  if (gridBlocks.length < 2 || !sharesHeader(gridBlocks)) return undefined
  if (!grids.every((grid) => isCongruent(grids[0], grid, bodyHeight))) return undefined
  return blocks
}

/**
 * A block's inner columns, or undefined when it is not a grid. Only rows with
 * two or more cells count, so a title spanning the first columns —
 * `January 2026` against `May 2026` — does not make two months look different.
 */
function gridSignature(rows: readonly LayoutRow[], minGridGap: number): Interval[] | undefined {
  const gridRows = rows.filter((row) => rowIntervals(row, minGridGap).length >= 2)
  if (gridRows.length < MIN_BLOCK_ROWS) return undefined
  const intervals = blockIntervals(gridRows, minGridGap)
  return widestGap(intervals) >= minGridGap ? intervals : undefined
}

/** Same width and the same inner column starts, within tolerance. */
function isCongruent(
  reference: readonly Interval[],
  grid: readonly Interval[],
  bodyHeight: number
): boolean {
  const referenceWidth = extentWidth(reference)
  const tolerance = Math.max(CONGRUENT_WIDTH_RATIO * referenceWidth, bodyHeight)
  if (Math.abs(extentWidth(grid) - referenceWidth) > tolerance) return false
  if (grid.length !== reference.length) return false
  const origin = grid[0][0]
  const referenceOrigin = reference[0][0]
  return grid.every(
    (interval, i) =>
      Math.abs(interval[0] - origin - (reference[i][0] - referenceOrigin)) <= bodyHeight
  )
}

function extentWidth(intervals: readonly Interval[]): number {
  return intervals[intervals.length - 1][1] - intervals[0][0]
}

/**
 * Whether every block repeats one header row of two or more words near its top
 * — `Su Mo Tu We Th Fr Sa` on each month, `Assets Liabilities` on each account,
 * whether drawn as one text item or one per cell. Independent blocks cut from
 * one template carry it; column groups of a single table do not, and a lone
 * generic label such as `Amount` never counts.
 */
function sharesHeader(blocks: readonly LayoutRow[][]): boolean {
  const headers = blocks.map(
    (rows) =>
      new Set(
        rows
          .slice(0, HEADER_SEARCH_ROWS)
          .map(rowText)
          .filter((text) => LETTER.test(text) && text.split(/\s+/).length >= 2)
      )
  )
  const [first, ...rest] = headers
  for (const text of first) if (rest.every((header) => header.has(text))) return true
  return false
}

function rowText(row: LayoutRow): string {
  return row.items.map((item) => item.str.trim()).join(' ')
}

/**
 * Whether the stream crosses between blocks more often than one pass per
 * block would — a producer that already draws block by block is left alone.
 */
function isInterleaved(blocks: readonly LayoutRow[][]): boolean {
  const owner: Array<[number, number]> = []
  blocks.forEach((rows, block) => {
    for (const row of rows) for (const item of row.items) owner.push([item.index, block])
  })
  owner.sort((a, b) => a[0] - b[0])
  let switches = 0
  for (let i = 1; i < owner.length; i++) if (owner[i][1] !== owner[i - 1][1]) switches++
  return switches > blocks.length
}

function spanOf(blocks: LayoutRow[][]): ReorderedBand {
  let last = Number.NEGATIVE_INFINITY
  for (const rows of blocks) {
    for (const row of rows) for (const item of row.items) last = Math.max(last, item.index)
  }
  return { blocks, last }
}

/** Which block an x-position belongs to, given the left edges of the gutters. */
function blockIndex(x: number, gutterStarts: readonly number[]): number {
  let index = 0
  while (index < gutterStarts.length && x >= gutterStarts[index]) index++
  return index
}

/** A block's x-extent across all its rows, with gaps narrower than `minGap` coalesced. */
function blockIntervals(rows: readonly LayoutRow[], minGap: number): Interval[] {
  const intervals: Interval[] = []
  for (const row of rows) {
    for (const item of row.items) {
      intervals.push([item.geometry.x, item.geometry.x + item.geometry.width])
    }
  }
  return mergeIntervals([], intervals, minGap)
}

function widestGap(intervals: readonly Interval[]): number {
  let widest = 0
  for (let i = 1; i < intervals.length; i++) {
    widest = Math.max(widest, intervals[i][0] - intervals[i - 1][1])
  }
  return widest
}

/** Rows from top to bottom, each sorted left to right. */
function groupRows(items: readonly LayoutItem[], bodyHeight: number): LayoutRow[] {
  const sorted = [...items].sort(
    (left, right) => right.geometry.y - left.geometry.y || left.geometry.x - right.geometry.x
  )
  const rows: LayoutRow[] = []
  let current: LayoutRow | undefined
  let rowHeight = 0
  for (const item of sorted) {
    const height = Math.max(item.geometry.height, rowHeight, bodyHeight)
    if (current && current.y - item.geometry.y <= ROW_TOLERANCE_RATIO * height) {
      current.items.push(item)
      rowHeight = Math.max(rowHeight, item.geometry.height)
      continue
    }
    current = { y: item.geometry.y, items: [item] }
    rowHeight = item.geometry.height
    rows.push(current)
  }
  for (const row of rows) row.items.sort((left, right) => left.geometry.x - right.geometry.x)
  return rows
}

/** A row's x-extent, with intervals closer than `minGap` coalesced. */
function rowIntervals(row: LayoutRow, minGap: number): Interval[] {
  return mergeIntervals(
    [],
    row.items.map((item) => [item.geometry.x, item.geometry.x + item.geometry.width]),
    minGap
  )
}

/**
 * Unions two interval lists, coalescing any pair separated by less than
 * `minGap`; narrower gaps never matter to the caller, and dropping them keeps
 * the list short.
 */
function mergeIntervals(
  left: readonly Interval[],
  right: readonly Interval[],
  minGap: number
): Interval[] {
  const all = [...left, ...right].sort((a, b) => a[0] - b[0])
  const merged: Interval[] = []
  for (const [start, end] of all) {
    const last = merged[merged.length - 1]
    if (last && start - last[1] < minGap) {
      last[1] = Math.max(last[1], end)
      continue
    }
    merged.push([start, end])
  }
  return merged
}

/**
 * Median downward step between consecutive rows; 0 with fewer than two. Only
 * rows that a gutter divides are passed in, so dense text elsewhere on the page
 * cannot shrink the pitch a band is measured against.
 */
function rowPitch(rows: readonly LayoutRow[]): number {
  const steps: number[] = []
  for (let i = 1; i < rows.length; i++) steps.push(rows[i - 1].y - rows[i].y)
  if (steps.length === 0) return 0
  steps.sort((left, right) => left - right)
  return steps[Math.floor((steps.length - 1) / 2)]
}

/** Median positive item height; 0 when no item reports one. */
function medianHeight(items: readonly LayoutItem[]): number {
  const heights = items.map((item) => item.geometry.height).filter((height) => height > 0)
  if (heights.length === 0) return 0
  heights.sort((left, right) => left - right)
  return heights[Math.floor((heights.length - 1) / 2)]
}
