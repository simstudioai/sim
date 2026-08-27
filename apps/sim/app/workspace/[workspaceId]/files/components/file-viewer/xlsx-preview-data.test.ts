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
    }

    expect(options.range.e.r - options.range.s.r).toBe(XLSX_MAX_ROWS)
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
})
