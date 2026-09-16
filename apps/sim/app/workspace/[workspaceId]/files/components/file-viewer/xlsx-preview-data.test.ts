/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  readXlsxPreviewData,
  readXlsxWorkbook,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/xlsx-preview-data'

describe('readXlsxPreviewData', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bounds conversion to the rows the preview can display', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['header-a', 'header-b'],
      ['row-1-a', 'row-1-b'],
      ['row-2-a', 'row-2-b'],
    ])
    sheet['!ref'] = 'A1:B200000'
    const toJson = vi.spyOn(XLSX.utils, 'sheet_to_json')

    const result = readXlsxPreviewData(XLSX, sheet)
    const options = toJson.mock.calls[0][1] as {
      range: { s: { r: number }; e: { r: number } }
      raw?: boolean
    }

    expect(options.range.e.r - options.range.s.r).toBe(XLSX_MAX_ROWS)
    expect(options.raw).toBe(false)
    expect(result.headers).toEqual(['header-a', 'header-b'])
    expect(result.rows).toHaveLength(XLSX_MAX_ROWS)
    expect(result.rows.slice(0, 2)).toEqual([
      ['row-1-a', 'row-1-b'],
      ['row-2-a', 'row-2-b'],
    ])
    expect(result.rowTruncated).toBe(true)
    expect(result.columnTruncated).toBe(false)
  })

  it('does not mark a sheet at the existing display boundary as truncated', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['header'],
      ...Array.from({ length: XLSX_MAX_ROWS }, (_, index) => [`row-${index}`]),
    ])

    const result = readXlsxPreviewData(XLSX, sheet)

    expect(result.rows).toHaveLength(XLSX_MAX_ROWS)
    expect(result.rowTruncated).toBe(false)
    expect(result.columnTruncated).toBe(false)
  })

  it('bounds conversion for extremely wide declared ranges', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['header-a', 'header-b'],
      ['row-1-a', 'row-1-b'],
    ])
    sheet['!ref'] = 'A1:XFD2'
    const toJson = vi.spyOn(XLSX.utils, 'sheet_to_json')

    const result = readXlsxPreviewData(XLSX, sheet)
    const options = toJson.mock.calls[0][1] as {
      range: { s: { c: number }; e: { c: number } }
    }

    expect(options.range.e.c - options.range.s.c + 1).toBe(XLSX_MAX_COLUMNS)
    expect(result.headers).toEqual(['header-a', 'header-b'])
    expect(result.rows).toEqual([['row-1-a', 'row-1-b']])
    expect(result.rowTruncated).toBe(false)
    expect(result.columnTruncated).toBe(true)
  })

  /**
   * Built through the viewer's own read path rather than by hand-setting `z`,
   * so the assertions cover the read options as well as the conversion.
   */
  function typedWorkbook(): ArrayBuffer {
    const sheet = XLSX.utils.aoa_to_sheet([['Issued', 'Rate', 'Card', 'Elapsed']])
    sheet.A2 = { t: 'd', v: new Date(Date.UTC(2026, 2, 4)), z: 'm/d/yyyy' }
    sheet.B2 = { t: 'n', v: 0.2, z: '0%' }
    sheet.C2 = { t: 'n', v: 4111111111111111 }
    sheet.D2 = { t: 'n', v: 1.25, z: '[h]:mm' }
    sheet['!ref'] = 'A1:D2'
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Ledger')
    const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  it('shows display text rather than stored values', () => {
    const workbook = readXlsxWorkbook(XLSX, typedWorkbook())

    const result = readXlsxPreviewData(XLSX, workbook.Sheets.Ledger)

    expect(result.rows).toEqual([['2026-03-04', '20%', '4111111111111111', '30:00']])
  })

  it('reads the workbook with the display-text options', () => {
    const read = vi.fn(XLSX.read)

    readXlsxWorkbook({ read, utils: XLSX.utils }, typedWorkbook())

    expect(read.mock.calls[0][1]).toMatchObject({ type: 'array', cellDates: true, cellNF: true })
  })
})
