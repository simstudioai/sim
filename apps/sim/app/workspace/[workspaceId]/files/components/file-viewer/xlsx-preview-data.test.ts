/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  readXlsxPreviewData,
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
   * The viewer reads the workbook without `cellDates`, so a date arrives as a
   * number carrying the file's formatted text; `raw: false` shows that text
   * instead of the serial, and a General number keeps its full digits.
   */
  it('shows display text rather than stored values', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Issued', 'Rate', 'Card']])
    sheet.A2 = { t: 'n', v: 46085, z: 'yyyy-mm-dd', w: '2026-03-04' }
    sheet.B2 = { t: 'n', v: 0.2, z: '0%', w: '20%' }
    sheet.C2 = { t: 'n', v: 4111111111111111, z: 'General', w: '4.11111E+15' }
    sheet['!ref'] = 'A1:C2'

    const result = readXlsxPreviewData(XLSX, sheet)

    expect(result.rows).toEqual([['2026-03-04', '20%', '4111111111111111']])
  })
})
