/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  generalNumberText,
  isoDateText,
  isTimeOnlyFormat,
  normalizeSheetDisplayText,
} from '@/lib/file-parsers/sheet-display-text'
import { XlsxParser } from '@/lib/file-parsers/xlsx-parser'

/**
 * Every date below is built with `Date.UTC` and asserted as an ISO slice, so
 * the expectations hold whatever `TZ` the runner has. The suite is also run
 * under `TZ=Asia/Tokyo` and `TZ=America/Los_Angeles` from the CLI to prove the
 * parser itself is zone-independent: a `String(date)` rendering would print
 * the runner's zone and a serial-to-local conversion would shift the day.
 */
function typedSheet(): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Issued', 'At', 'Rate', 'Amount', 'Paid', 'Total', 'Card', 'Sum', 'Note'],
  ])
  sheet.A2 = { t: 'd', v: new Date(Date.UTC(2026, 2, 4)), z: 'm/d/yyyy' }
  sheet.B2 = { t: 'd', v: new Date(Date.UTC(2026, 2, 4, 12)), z: 'm/d/yyyy h:mm' }
  sheet.C2 = { t: 'n', v: 0.085, z: '0.0%' }
  sheet.D2 = { t: 'n', v: 1250, z: '"$"#,##0.00' }
  sheet.E2 = { t: 'b', v: true }
  sheet.F2 = { t: 'n', v: 2500, f: 'D2*2', z: '"$"#,##0.00' }
  sheet.G2 = { t: 'n', v: 4111111111111111 }
  sheet.H2 = { t: 'n', v: 0.1 + 0.2 }
  sheet.I2 = { t: 's', v: 'left\tright' }
  sheet['!ref'] = 'A1:I2'
  return sheet
}

function typedWorkbook(bookType: XLSX.BookType, date1904 = false): Buffer {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, typedSheet(), 'Ledger')
  if (date1904) book.Workbook = { WBProps: { date1904: true } }
  return XLSX.write(book, { type: 'buffer', bookType }) as Buffer
}

function dataRow(content: string): string[] {
  const lines = content.split('\n')
  return lines[lines.length - 1].split('\t')
}

describe('XlsxParser display text', () => {
  it('indexes the text a user sees rather than the stored value', async () => {
    const result = await new XlsxParser().parseBuffer(typedWorkbook('xlsx'))

    expect(dataRow(result.content)).toEqual([
      '2026-03-04',
      '2026-03-04T12:00:00',
      '8.5%',
      '$1,250.00',
      'TRUE',
      '$2,500.00',
      '4111111111111111',
      '0.3',
      'left right',
    ])
  })

  it('renders dates from a date1904 workbook identically', async () => {
    const result = await new XlsxParser().parseBuffer(typedWorkbook('xlsx', true))

    expect(dataRow(result.content).slice(0, 2)).toEqual(['2026-03-04', '2026-03-04T12:00:00'])
  })

  /**
   * A time-of-day serial lands on 1899-12-31 in a 1900 workbook and on
   * 1904-01-01 in a 1904 one, so the decision must come from the format, not
   * the epoch date. Elapsed formats are durations Excel shows as `30:00`.
   */
  describe.each([
    ['xlsx', false],
    ['xlsx', true],
    ['xls', false],
    ['xls', true],
    ['xlsb', false],
    ['xlsb', true],
  ] as const)('time cells in %s (date1904: %s)', (bookType, date1904) => {
    function timeWorkbook(): Buffer {
      const sheet = XLSX.utils.aoa_to_sheet([['Clock', 'Meridiem', 'Elapsed', 'Minutes', 'Month']])
      sheet.A2 = { t: 'n', v: 0.520821759, z: 'h:mm:ss' }
      sheet.B2 = { t: 'n', v: 0.75, z: 'hh:mm AM/PM' }
      sheet.C2 = { t: 'n', v: 1.25, z: '[h]:mm' }
      sheet.D2 = { t: 'n', v: 0.5, z: '[mm]:ss' }
      sheet.E2 = { t: 'n', v: 46085, z: 'mmm' }
      sheet['!ref'] = 'A1:E2'
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Times')
      if (date1904) book.Workbook = { WBProps: { date1904: true } }
      return XLSX.write(book, { type: 'buffer', bookType }) as Buffer
    }

    it('rounds float serials to the second instead of truncating', async () => {
      const sheet = XLSX.utils.aoa_to_sheet([['When', 'Clock']])
      sheet.A2 = { t: 'n', v: 45366.572916666664, z: 'yyyy-mm-dd h:mm' }
      sheet.B2 = { t: 'n', v: 0.6041666666666666, z: 'h:mm' }
      sheet['!ref'] = 'A1:B2'
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Times')
      if (date1904) book.Workbook = { WBProps: { date1904: true } }
      const buffer = XLSX.write(book, { type: 'buffer', bookType }) as Buffer

      const result = await new XlsxParser().parseBuffer(buffer)

      const row = dataRow(result.content)
      expect(row[0]).toMatch(/^\d{4}-\d{2}-\d{2}T13:45:00$/)
      expect(row[1]).toBe('14:30:00')
    })

    it('renders time-only cells as times and elapsed cells as durations', async () => {
      const result = await new XlsxParser().parseBuffer(timeWorkbook())

      const row = dataRow(result.content)
      expect(row.slice(0, 4)).toEqual(['12:29:59', '18:00:00', '30:00', '720:00'])
      expect(row[4]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  /**
   * The SheetJS ODS writer stores each serial as the cell text, so an elapsed
   * cell reads back its serial; time-only cells still come from the format.
   */
  it.each([false, true])('renders time-only cells from ods (date1904: %s)', async (date1904) => {
    const sheet = XLSX.utils.aoa_to_sheet([['Clock']])
    sheet.A2 = { t: 'n', v: 0.520821759, z: 'h:mm:ss' }
    sheet['!ref'] = 'A1:A2'
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Times')
    if (date1904) book.Workbook = { WBProps: { date1904: true } }
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'ods' }) as Buffer

    const result = await new XlsxParser().parseBuffer(buffer)

    expect(dataRow(result.content)).toEqual(['12:29:59'])
  })

  it.each(['xls', 'xlsb'] as const)('renders the same display text from %s', async (bookType) => {
    const result = await new XlsxParser().parseBuffer(typedWorkbook(bookType))

    expect(dataRow(result.content).slice(0, 6)).toEqual([
      '2026-03-04',
      '2026-03-04T12:00:00',
      '8.5%',
      '$1,250.00',
      'TRUE',
      '$2,500.00',
    ])
  })

  /**
   * The SheetJS ODS writer emits each number's stored value as the cell text
   * the reader then trusts, so only dates, booleans and General numbers can be
   * asserted through a round trip.
   */
  it('renders ISO dates from an ods round trip', async () => {
    const result = await new XlsxParser().parseBuffer(typedWorkbook('ods'))

    const row = dataRow(result.content)
    expect(row.slice(0, 2)).toEqual(['2026-03-04', '2026-03-04T12:00:00'])
    expect(row[4]).toBe('TRUE')
    expect(row[6]).toBe('4111111111111111')
  })

  it('keeps the sampled metadata on display text as well', async () => {
    const result = await new XlsxParser().parseBuffer(typedWorkbook('xlsx'))

    const sampled = result.metadata?.sampledData as string[][]
    expect(sampled[1].slice(0, 4)).toEqual([
      '2026-03-04',
      '2026-03-04T12:00:00',
      '8.5%',
      '$1,250.00',
    ])
  })
})

describe('isoDateText', () => {
  it('drops a midnight time and keeps a non-midnight one without a zone suffix', () => {
    expect(isoDateText(new Date(Date.UTC(2026, 2, 4)))).toBe('2026-03-04')
    expect(isoDateText(new Date(Date.UTC(2026, 2, 4, 12, 30, 15)))).toBe('2026-03-04T12:30:15')
  })

  it('renders an invalid date as empty text', () => {
    expect(isoDateText(new Date(Number.NaN))).toBe('')
  })

  it('rounds the sub-second drift of a float serial to the nearest second', () => {
    const datetime = XLSX.SSF.parse_date_code(45366.572916666664)
    const time = XLSX.SSF.parse_date_code(0.6041666666666666)
    const toDate = (d: XLSX.SSF.DateObject) =>
      new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, d.S, Math.round(d.u * 1000)))

    expect(isoDateText(new Date(Date.UTC(2024, 2, 15, 13, 44, 59, 999)), 'yyyy-mm-dd h:mm')).toBe(
      '2024-03-15T13:45:00'
    )
    expect(isoDateText(toDate(datetime), 'yyyy-mm-dd h:mm')).toBe('2024-03-15T13:45:00')
    expect(isoDateText(toDate(time), 'h:mm')).toBe('14:30:00')
    expect(isoDateText(new Date(Date.UTC(2024, 2, 15, 23, 59, 59, 700)), 'yyyy-mm-dd')).toBe(
      '2024-03-16'
    )
  })

  it('renders a formatless date before 1900 as a time of day', () => {
    expect(isoDateText(new Date(Date.UTC(1899, 11, 30, 0, 30, 0)))).toBe('00:30:00')
    expect(isoDateText(new Date(Date.UTC(1899, 11, 31, 13, 5, 9)))).toBe('13:05:09')
  })

  it('decides time of day from the format whatever the epoch date', () => {
    expect(isoDateText(new Date(Date.UTC(1904, 0, 1, 12, 29, 59)), 'h:mm:ss')).toBe('12:29:59')
    expect(isoDateText(new Date(Date.UTC(1899, 11, 31, 12, 0, 0)), 'yyyy-mm-dd')).toBe(
      '1899-12-31T12:00:00'
    )
  })
})

describe('isTimeOnlyFormat', () => {
  it.each(['h:mm:ss', 'hh:mm AM/PM', 'h:mm', 'mm:ss', '[$-409]h:mm:ss', 'hh"h"mm'])(
    'treats %s as time only',
    (format) => {
      expect(isTimeOnlyFormat(format)).toBe(true)
    }
  )

  it.each(['m/d/yyyy', 'yyyy-mm-dd hh:mm', 'mmm', 'd-mmm', 'mmmm yyyy', 'General'])(
    'treats %s as a date',
    (format) => {
      expect(isTimeOnlyFormat(format)).toBe(false)
    }
  )
})

describe('generalNumberText', () => {
  it('keeps integers exact and rounds fractions to 15 significant digits', () => {
    expect(generalNumberText(4111111111111111)).toBe('4111111111111111')
    expect(generalNumberText(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991')
    expect(generalNumberText(0.1 + 0.2)).toBe('0.3')
    expect(generalNumberText(1063.8425)).toBe('1063.8425')
    expect(generalNumberText(1.22464679914735e-16)).toBe('1.22464679914735e-16')
  })
})

describe('normalizeSheetDisplayText', () => {
  it('rewrites dates and General numbers on a sparse sheet and leaves formatted cells alone', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['a']])
    sheet.A1 = { t: 'd', v: new Date(Date.UTC(2026, 2, 4)), z: 'm/d/yyyy', w: '3/4/2026' }
    sheet.B1 = { t: 'n', v: 4111111111111111, z: 'General', w: '4.11111E+15' }
    sheet.C1 = { t: 'n', v: 1250, z: '"$"#,##0.00', w: '$1,250.00' }
    sheet.D1 = { t: 'n', v: 9, w: '9' }
    sheet['!ref'] = 'A1:D1'

    normalizeSheetDisplayText(sheet, XLSX.utils.decode_range('A1:C1'), XLSX.utils)

    expect(sheet.A1.w).toBe('2026-03-04')
    expect(sheet.B1.w).toBe('4111111111111111')
    expect(sheet.C1.w).toBe('$1,250.00')
    expect(sheet.D1.w).toBe('9')
  })

  it('keeps the rendered duration of an elapsed-time cell', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['a']])
    sheet.A1 = { t: 'd', v: new Date(Date.UTC(1900, 0, 1, 6)), z: '[h]:mm', w: '30:00' }
    sheet.B1 = { t: 'd', v: new Date(Date.UTC(1899, 11, 31, 12)), z: '[mm]:ss', w: '720:00' }
    sheet['!ref'] = 'A1:B1'

    normalizeSheetDisplayText(sheet, XLSX.utils.decode_range('A1:B1'), XLSX.utils)

    expect(sheet.A1.w).toBe('30:00')
    expect(sheet.B1.w).toBe('720:00')
  })

  it('touches only the window on a dense sheet', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['a']], { dense: true })
    const inside = { t: 'd', v: new Date(Date.UTC(2026, 2, 4)), w: '3/4/2026' } as XLSX.CellObject
    const outside = { t: 'd', v: new Date(Date.UTC(2026, 2, 5)), w: '3/5/2026' } as XLSX.CellObject
    sheet['!data'] = [[inside], [outside]]

    normalizeSheetDisplayText(sheet, XLSX.utils.decode_range('A1:A1'), XLSX.utils)

    expect(inside.w).toBe('2026-03-04')
    expect(outside.w).toBe('3/5/2026')
  })
})
