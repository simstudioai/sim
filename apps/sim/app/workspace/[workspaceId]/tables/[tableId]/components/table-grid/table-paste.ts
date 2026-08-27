import { countPasteRows } from '@sim/utils/paste'

export interface ParsedTablePaste {
  rows: string[][]
  maxColumns: number
}

/** Matches {@link parseBoundedTsv}: a final row separator does not create an empty pasted row. */
export function exceedsTablePasteRowLimit(text: string, maxRows: number): boolean {
  const hasTrailingRowBreak = text.endsWith('\n') || text.endsWith('\r')
  const rowCount = countPasteRows(text, maxRows + 1) - (hasTrailingRowBreak ? 1 : 0)
  return rowCount > maxRows
}

/**
 * Parses the table's intentionally simple TSV clipboard format while retaining only columns that can
 * land in the grid. `String.split()` materializes every ignored cell, so a single tab-heavy line can
 * otherwise allocate an unbounded array before the editor notices it has no corresponding columns.
 */
export function parseBoundedTsv(text: string, columnLimit: number): ParsedTablePaste {
  if (!text || columnLimit < 1) return { rows: [], maxColumns: 0 }

  const rows: string[][] = []
  let row: string[] = []
  let column = 0
  let cellStart = 0
  let maxColumns = 0

  const finishCell = (end: number) => {
    if (column < columnLimit) row.push(text.slice(cellStart, end))
    column += 1
  }

  const finishRow = () => {
    if (row.length > 0) {
      maxColumns = Math.max(maxColumns, row.length)
      rows.push(row)
    }
    row = []
    column = 0
  }

  for (let index = 0; index <= text.length; index++) {
    if (index === text.length) {
      if (cellStart < text.length || column > 0) {
        finishCell(index)
        finishRow()
      }
      break
    }

    const code = text.charCodeAt(index)
    if (code === 9) {
      finishCell(index)
      cellStart = index + 1
      continue
    }
    if (code !== 10 && code !== 13) continue

    finishCell(index)
    finishRow()
    if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1
    cellStart = index + 1
  }

  return { rows, maxColumns }
}
