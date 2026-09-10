import type { WorkSheet } from 'xlsx'
import { normalizeSheetDisplayText } from '@/lib/file-parsers/sheet-display-text'

export const XLSX_MAX_ROWS = 1_000
export const XLSX_MAX_COLUMNS = 200

interface XlsxModule {
  utils: Pick<typeof import('xlsx').utils, 'decode_range' | 'encode_cell' | 'sheet_to_json'>
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
  const window = {
    s: declaredRange.s,
    e: { r: lastPreviewRow, c: lastPreviewColumn },
  }

  /**
   * Shown as the text a user sees in Excel: `raw: false` emits each cell's
   * formatted text so a date cell reads as a date rather than its serial.
   */
  normalizeSheetDisplayText(sheet, window, XLSX.utils)
  const previewRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    range: window,
  })

  return {
    headers: previewRows[0] ?? [],
    rows: previewRows.slice(1),
    rowTruncated: declaredRange.e.r > lastPreviewRow,
    columnTruncated: declaredRange.e.c > lastPreviewColumn,
  }
}
