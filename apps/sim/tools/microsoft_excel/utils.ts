import type { ExcelCellValue } from '@/tools/microsoft_excel/types'

export function trimTrailingEmptyRowsAndColumns(matrix: ExcelCellValue[][]): ExcelCellValue[][] {
  if (!Array.isArray(matrix) || matrix.length === 0) return []

  const isEmptyValue = (v: ExcelCellValue) => v === null || v === ''

  // Determine last non-empty row
  let lastNonEmptyRowIndex = -1
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] || []
    const hasData = row.some((cell: ExcelCellValue) => !isEmptyValue(cell))
    if (hasData) lastNonEmptyRowIndex = r
  }

  if (lastNonEmptyRowIndex === -1) return []

  const trimmedRows = matrix.slice(0, lastNonEmptyRowIndex + 1)

  // Determine last non-empty column across trimmed rows
  let lastNonEmptyColIndex = -1
  for (let r = 0; r < trimmedRows.length; r++) {
    const row = trimmedRows[r] || []
    for (let c = 0; c < row.length; c++) {
      if (!isEmptyValue(row[c])) {
        if (c > lastNonEmptyColIndex) lastNonEmptyColIndex = c
      }
    }
  }

  if (lastNonEmptyColIndex === -1) return []

  return trimmedRows.map((row) => (row || []).slice(0, lastNonEmptyColIndex + 1))
}
