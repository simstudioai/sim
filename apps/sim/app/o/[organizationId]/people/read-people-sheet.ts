import { PEOPLE_IMPORT_MAX_ROWS } from '@/lib/api/contracts/people'
import { assertOoxmlPreviewWithinLimits } from '@/lib/file-parsers/ooxml-preview-guard'

const MAX_FILE_BYTES = 5 * 1024 * 1024

export interface PeopleSheet {
  fileName: string
  headers: string[]
  /** Each row's cells, in `headers` order. */
  rows: string[][]
}

/**
 * The first sheet's named columns and its rows of cells, one per sheet row (blank ones included) so the
 * row numbers in the preview match the spreadsheet. Delimited text is read verbatim so the server
 * interprets dates the same way for every file. A spreadsheet date cell is read from its stored
 * value, not the text its locale displays, so `31/01/2024` and `1/31/24` both arrive as
 * `2024-01-31`.
 */
export async function readPeopleSheet(file: File): Promise<PeopleSheet> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file under 5 MB')
  const data = new Uint8Array(await file.arrayBuffer())
  if (/\.xlsx$/i.test(file.name)) await assertOoxmlPreviewWithinLimits(data)
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(data, {
    type: 'array',
    raw: /\.(csv|tsv)$/i.test(file.name),
    dense: true,
    // Keeps each cell's number format, which is how a date cell is told from a number.
    cellNF: true,
  })
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  // Workbooks saved in the 1904 date system count their date serials from a different epoch.
  const dateSystem = { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) }
  if (!sheet?.['!ref']) throw new Error('The file has no rows')
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const grid = sheet['!data'] ?? []
  const text = (row: number, column: number): string => {
    const cell = grid[row]?.[column]
    if (!cell || cell.v === undefined || cell.v === null) return ''
    if (cell.t === 'n' && XLSX.SSF.is_date(cell.z ?? '')) {
      // A serial outside Excel's calendar has no date; its text goes on for the server to refuse.
      const date = XLSX.SSF.parse_date_code(Number(cell.v), dateSystem)
      if (date)
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
    }
    return String(cell.w ?? cell.v).trim()
  }
  const columns: { header: string; index: number }[] = []
  for (let index = range.s.c; index <= range.e.c; index++) {
    const header = text(range.s.r, index)
    if (!header) continue
    if (columns.some((column) => column.header === header)) {
      throw new Error(`The ${header} column appears more than once`)
    }
    columns.push({ header, index })
  }
  if (!columns.length) throw new Error('The first row should name the columns')
  const rowCount = range.e.r - range.s.r
  if (rowCount > PEOPLE_IMPORT_MAX_ROWS) {
    throw new Error(`Import at most ${PEOPLE_IMPORT_MAX_ROWS} rows at a time`)
  }
  return {
    fileName: file.name,
    headers: columns.map(({ header }) => header),
    rows: Array.from({ length: rowCount }, (_, offset) =>
      columns.map(({ index }) => text(range.s.r + 1 + offset, index))
    ),
  }
}
