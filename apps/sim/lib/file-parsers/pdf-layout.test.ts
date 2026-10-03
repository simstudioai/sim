import { describe, expect, it } from 'vitest'
import {
  type BufferedItem,
  findInterleavedBands,
  MAX_PDF_LAYOUT_ITEMS,
  PdfPageCollector,
} from '@/lib/file-parsers/pdf-layout'
import { joinLines, type PdfItemGeometry } from '@/lib/file-parsers/pdf-lines'

const HEIGHT = 8
const CHAR_WIDTH = 4.5

function placed(str: string, x: number, y: number, height = HEIGHT): BufferedItem {
  const geometry: PdfItemGeometry = { x, y, width: str.length * CHAR_WIDTH, height }
  return { str, geometry, hasEOL: false }
}

function readPage(items: readonly BufferedItem[]): string {
  const collector = new PdfPageCollector()
  for (const item of items) collector.add(item.str, item.geometry, item.hasEOL)
  return joinLines(collector.finish())
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
const CELL = 16
const ROW_PITCH = 12

interface Month {
  name: string
  firstWeekday: number
  days: number
  x: number
}

/** A month's rows as text, the way a reader expects them. */
function monthRows(month: Month): string[] {
  const rows = [month.name, WEEKDAYS.join(' ')]
  let week: string[] = []
  for (let day = 1; day <= month.days; day++) {
    week.push(String(day))
    if ((month.firstWeekday + day) % 7 === 0 || day === month.days) {
      rows.push(week.join(' '))
      week = []
    }
  }
  return rows
}

/** Positioned items for one visual row of a month: its title, weekday header, or a week. */
function monthRowItems(month: Month, row: number, y: number): BufferedItem[] {
  if (row === 0) return [placed(month.name, month.x, y)]
  if (row === 1) return WEEKDAYS.map((day, i) => placed(day, month.x + i * CELL, y))
  const items: BufferedItem[] = []
  for (let day = 1; day <= month.days; day++) {
    const slot = month.firstWeekday + day - 1
    if (Math.floor(slot / 7) + 2 === row) {
      items.push(placed(String(day), month.x + (slot % 7) * CELL, y))
    }
  }
  return items
}

/**
 * Three months side by side, drawn the way calendar producers draw them: one
 * visual row across every month before the next row.
 */
function quarterCalendar(): { items: BufferedItem[]; months: Month[] } {
  const months: Month[] = [
    { name: 'January 2026', firstWeekday: 4, days: 31, x: 40 },
    { name: 'February 2026', firstWeekday: 0, days: 28, x: 188 },
    { name: 'March 2026', firstWeekday: 0, days: 31, x: 336 },
  ]
  const items: BufferedItem[] = [placed('2026 Calendar', 200, 740, 14)]
  for (let row = 0; row < 8; row++) {
    for (const month of months) items.push(...monthRowItems(month, row, 700 - row * ROW_PITCH))
  }
  return { items, months }
}

describe('PdfPageCollector', () => {
  it('reads side-by-side calendar months one month at a time', () => {
    const { items, months } = quarterCalendar()

    const text = readPage(items)

    const expected = ['2026 Calendar', ...months.map((month) => monthRows(month).join('\n'))]
    expect(text).toBe(expected.join('\n\n'))
  })

  it('keeps a two-column table of wrapped prose cells row by row', () => {
    const left = [
      'Every request is reviewed on a fixed weekly',
      'schedule set by the team that owns the queue.',
      'Each review closes the request or sends it back.',
    ]
    const right = [
      'Office hours open two days after each release',
      'and close two weeks before the next one ships.',
      'Freeze periods apply to every team member.',
    ]
    const items = left.flatMap((line, i) => [
      placed(line, 40, 700 - i * 12),
      placed(right[i], 300, 700 - i * 12),
    ])

    expect(findInterleavedBands(items)).toEqual([])
  })

  it('matches a repeated header whose cells hold several words', () => {
    const boxes = [
      {
        x: 40,
        rows: [
          ['Cash', 'Payables'],
          ['Receivables', 'Accrued wages'],
        ],
      },
      {
        x: 400,
        rows: [
          ['Deposits', 'Loans'],
          ['Securities', 'Borrowings'],
        ],
      },
    ]
    const header = ['Current Assets', 'Current Liabilities']
    const items: BufferedItem[] = []
    for (let i = 0; i < 3; i++) {
      for (const box of boxes) {
        const cells = i === 0 ? header : box.rows[i - 1]
        cells.forEach((cell, c) => items.push(placed(cell, box.x + c * 110, 700 - i * 12)))
      }
    }

    expect(findInterleavedBands(items)[0]?.blocks).toHaveLength(2)
  })

  it('separates compact small-type grid rows on a page of larger body text', () => {
    const { items, months } = quarterCalendar()
    const compact = items.map((item) =>
      item.geometry ? placed(item.str, item.geometry.x, 400 + (item.geometry.y - 700) / 3, 3) : item
    )
    const body = Array.from({ length: 200 }, (_, i) =>
      placed(`body text line ${i}`, 40, 300 - i * 14, 12)
    )

    const bands = findInterleavedBands([...compact, ...body])

    expect(bands).toHaveLength(1)
    expect(bands[0].blocks.map((block) => block.length)).toEqual(
      months.map((month) => monthRows(month).length)
    )
  })

  it('still splits calendar months when dense text elsewhere lowers the page pitch', () => {
    const { items } = quarterCalendar()
    for (let i = 0; i < 40; i++) {
      items.push(
        placed(`Footnote line ${i} with enough words to read as running text`, 40, 500 - i * 5, 3)
      )
    }

    const bands = findInterleavedBands(items)

    expect(bands).toHaveLength(1)
    expect(bands[0].blocks).toHaveLength(3)
  })

  it('keeps stream order when any item has no usable geometry', () => {
    const { items } = quarterCalendar()
    items.push({ str: 'rotated caption', geometry: undefined, hasEOL: true })

    expect(findInterleavedBands(items)).toEqual([])
  })

  it('streams in pdf.js order once a page exceeds the layout item cap', () => {
    const collector = new PdfPageCollector()
    for (let i = 0; i <= MAX_PDF_LAYOUT_ITEMS; i++) {
      collector.add(
        'x',
        { x: (i % 2) * 300, y: 700 - Math.floor(i / 2), width: 5, height: 1 },
        false
      )
    }

    const lines = collector.finish()

    expect(lines.some((line) => line.blockStart)).toBe(false)
    expect(lines.length).toBeGreaterThan(0)
  })
})
