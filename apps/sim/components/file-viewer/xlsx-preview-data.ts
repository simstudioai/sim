import type { WorkBook, WorkSheet } from 'xlsx'
import {
  normalizeSheetDisplayText,
  SHEET_DISPLAY_READ_OPTIONS,
} from '@/lib/file-parsers/sheet-display-text'

export const XLSX_MAX_ROWS = 1_000
export const XLSX_MAX_COLUMNS = 200

interface XlsxModule {
  read: typeof import('xlsx').read
  utils: Pick<typeof import('xlsx').utils, 'decode_range' | 'encode_cell' | 'sheet_to_json'>
}

/**
 * Reads a workbook for preview with the options that make its cells carry
 * display text: without `cellDates` a date arrives as a bare serial and
 * without `cellNF` no cell has a format, so every rendered `w` would be
 * overwritten as a General number.
 */
export function readXlsxWorkbook(XLSX: XlsxModule, data: ArrayBuffer): WorkBook {
  return XLSX.read(new Uint8Array(data), { type: 'array', ...SHEET_DISPLAY_READ_OPTIONS })
}

interface XlsxPreviewData {
  headers: string[]
  rows: string[][]
  rowTruncated: boolean
  columnTruncated: boolean
}

export function readXlsxPreviewData(XLSX: XlsxModule, sheet: WorkSheet): XlsxPreviewData {
  const declaredRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
  const lastPreviewRow = Math.min(declaredRange.e.r, declaredRange.s.r + XLSX_MAX_ROWS)
  const lastPreviewColumn = Math.min(declaredRange.e.c, declaredRange.s.c + XLSX_MAX_COLUMNS - 1)
  const previewRange = {
    s: declaredRange.s,
    e: { r: lastPreviewRow, c: lastPreviewColumn },
  }

  /**
   * Shown as the text a user sees in Excel: `raw: false` emits each cell's
   * formatted text, so a sheet read through {@link readXlsxWorkbook} shows a
   * date as ISO text and `20%` rather than a serial and `0.2`.
   */
  normalizeSheetDisplayText(sheet, previewRange, XLSX.utils)
  const previewRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    range: previewRange,
  })

  return {
    headers: previewRows[0] ?? [],
    rows: previewRows.slice(1),
    rowTruncated: declaredRange.e.r > lastPreviewRow,
    columnTruncated: declaredRange.e.c > lastPreviewColumn,
  }
}
