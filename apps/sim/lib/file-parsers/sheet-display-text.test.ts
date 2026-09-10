/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { isoDateText, normalizeSheetDisplayText } from '@/lib/file-parsers/sheet-display-text'
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
      '0.30000000000000004',
      'left',
      'right',
    ])
  })

  it('renders dates from a date1904 workbook identically', async () => {
    const result = await new XlsxParser().parseBuffer(typedWorkbook('xlsx', true))

    expect(dataRow(result.content).slice(0, 2)).toEqual(['2026-03-04', '2026-03-04T12:00:00'])
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
