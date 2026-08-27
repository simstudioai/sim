import type { WorkSheet } from 'xlsx'

export const XLSX_MAX_ROWS = 1_000

interface XlsxModule {
  utils: Pick<typeof import('xlsx').utils, 'decode_range' | 'sheet_to_json'>
}

interface XlsxPreviewData {
  headers: string[]
  rows: string[][]
  truncated: boolean
}

export function readXlsxPreviewData(XLSX: XlsxModule, sheet: WorkSheet): XlsxPreviewData {
  const declaredRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
  const lastPreviewRow = Math.min(declaredRange.e.r, declaredRange.s.r + XLSX_MAX_ROWS)
  const previewRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    range: {
      s: declaredRange.s,
      e: { r: lastPreviewRow, c: declaredRange.e.c },
    },
  })

  return {
    headers: previewRows[0] ?? [],
    rows: previewRows.slice(1),
    truncated: declaredRange.e.r > lastPreviewRow,
  }
}
