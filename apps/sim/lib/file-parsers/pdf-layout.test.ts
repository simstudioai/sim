/**
 * @vitest-environment node
 */
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

  it('leaves calendar months the stream already draws one at a time', () => {
    const { items } = quarterCalendar()
    const monthByMonth = [...items].sort((a, b) => (a.geometry?.x ?? 0) - (b.geometry?.x ?? 0))

    expect(findInterleavedBands(monthByMonth)).toEqual([])
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

  it('keeps a table with evenly spaced columns row by row', () => {
    const rows = [
      ['Name', 'Opened', 'Closed'],
      ['Ana Park', '1200', '300'],
      ['Ben Ortiz', '800', '200'],
    ]
    const items = rows.flatMap((cells, i) =>
      cells.map((cell, column) => placed(cell, 40 + column * 120, 700 - i * 12))
    )

    expect(findInterleavedBands(items)).toEqual([])
    expect(readPage(items)).toBe('Name Opened Closed\nAna Park 1200 300\nBen Ortiz 800 200')
  })

  it('keeps a label and value list row by row across a wide gutter', () => {
    const rows = [
      ['Employee', 'Ana Park'],
      ['Start date', '2024-03-01'],
      ['Location', 'Springfield'],
    ]
    const items = rows.flatMap(([label, value], i) => [
      placed(label, 40, 700 - i * 12),
      placed(value, 400, 700 - i * 12),
    ])

    expect(findInterleavedBands(items)).toEqual([])
  })

  it('keeps a table whose wrapped cells leave its label column sparse', () => {
    const items = [
      placed('Role', 40, 700),
      placed('Responsibility', 200, 700),
      placed('Author', 40, 688),
      placed('Writes the change and opens a request for review with a', 200, 688),
      placed('short summary of the risk involved.', 200, 676),
      placed('Owner', 40, 664),
      placed('Owns the document and reviews it once a year, then', 200, 664),
      placed('approves every exception in writing.', 200, 652),
    ]

    expect(findInterleavedBands(items)).toEqual([])
  })

  it('leaves side-by-side blocks the stream already draws one at a time', () => {
    const address = ['Jane Doe', 'Example Co', '1 Main Street', 'Phone: 555 0100']
    const items = [
      placed('TO:', 40, 700),
      ...address.map((line, i) => placed(line, 40, 688 - i * 12)),
      placed('SHIP TO:', 300, 700),
      ...address.map((line, i) => placed(line, 300, 688 - i * 12)),
    ]

    expect(findInterleavedBands(items)).toEqual([])
    expect(readPage(items)).toBe(`TO:\n${address.join('\n')}\n\nSHIP TO:\n${address.join('\n')}`)
  })

  it('reads a sparse legend column as its own block', () => {
    const { items, months } = quarterCalendar()
    const legend = ['Holiday', 'Office Closure', 'Deadline']
    items.push(...legend.map((label, i) => placed(label, 500, 688 - i * ROW_PITCH)))

    const text = readPage(items)

    const expected = [
      '2026 Calendar',
      ...months.map((month) => monthRows(month).join('\n')),
      legend.join('\n'),
    ]
    expect(text).toBe(expected.join('\n\n'))
  })

  it('keeps a table whose column groups differ in shape row by row', () => {
    const rows = [
      ['QUANTITY', 'DESCRIPTION', 'UNIT PRICE', 'TOTAL'],
      ['10', 'Standard widget, blue', '12.45', '124.50'],
      ['25', 'Standard widget, red', '8.10', '202.50'],
    ]
    const columns = [40, 100, 360, 440]
    const items = rows.flatMap((cells, i) =>
      cells.map((cell, column) => placed(cell, columns[column], 700 - i * 12))
    )

    expect(findInterleavedBands(items)).toEqual([])
  })

  it('keeps a grid of values without repeated headers row by row', () => {
    const words = [
      ['w0 = 603deb10', 'w1 = 15ca71be', 'w2 = 2b73aef0', 'w3 = 857d7781'],
      ['w4 = 1f352c07', 'w5 = 3b6108d7', 'w6 = 2d9810a3', 'w7 = 0914dff4'],
    ]
    const items = words.flatMap((row, i) =>
      row.flatMap((word, column) => {
        const [name, equals, value] = word.split(' ')
        const x = 40 + column * 130
        return [
          placed(name, x, 700 - i * 12),
          placed(equals, x + 16, 700 - i * 12),
          placed(value, x + 28, 700 - i * 12),
        ]
      })
    )

    expect(findInterleavedBands(items)).toEqual([])
  })

  it('reads side-by-side account boxes that repeat a header one box at a time', () => {
    const boxes = [
      { x: 40, rows: ['Business', 'Assets Liabilities', 'Buildings Loans'] },
      { x: 260, rows: ['Bank', 'Assets Liabilities', 'Securities Deposits'] },
      { x: 480, rows: ['Household', 'Assets Liabilities', 'Deposits Loans'] },
    ]
    const items: BufferedItem[] = []
    for (let row = 0; row < 3; row++) {
      for (const box of boxes) {
        const words = box.rows[row].split(' ')
        words.forEach((word, i) => items.push(placed(word, box.x + i * 50, 700 - row * 12)))
      }
    }

    expect(readPage(items)).toBe(boxes.map((box) => box.rows.join('\n')).join('\n\n'))
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

  it('keeps column groups that share only a single-cell label row by row', () => {
    const items: BufferedItem[] = []
    const rows = [
      ['Amount', 'Amount'],
      ['100 12', '300 34'],
      ['200 56', '400 78'],
      ['500 90', '600 11'],
    ]
    rows.forEach((groups, i) => {
      groups.forEach((group, g) => {
        group
          .split(' ')
          .forEach((cell, c) => items.push(placed(cell, 40 + g * 260 + c * 60, 700 - i * 12)))
      })
    })

    expect(findInterleavedBands(items)).toEqual([])
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
