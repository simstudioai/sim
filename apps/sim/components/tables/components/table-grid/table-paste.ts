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
  let maxColumns = 0
  const pushRow = (rowStart: number, rowEnd: number) => {
    const row: string[] = []
    let cellStart = rowStart
    while (row.length < columnLimit) {
      const tab = text.indexOf('\t', cellStart)
      if (tab < 0 || tab >= rowEnd) {
        row.push(text.slice(cellStart, rowEnd))
        break
      }
      row.push(text.slice(cellStart, tab))
      cellStart = tab + 1
    }
    maxColumns = Math.max(maxColumns, row.length)
    rows.push(row)
  }

  let rowStart = 0
  const rowBreak = /\r\n|\r|\n/g
  let match: RegExpExecArray | null
  while ((match = rowBreak.exec(text))) {
    pushRow(rowStart, match.index)
    rowStart = rowBreak.lastIndex
  }
  if (rowStart < text.length) pushRow(rowStart, text.length)

  return { rows, maxColumns }
}
