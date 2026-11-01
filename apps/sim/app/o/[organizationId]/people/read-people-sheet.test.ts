import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readPeopleSheet } from '@/app/o/[organizationId]/people/read-people-sheet'

/** January 31, 2024 as a date serial in each of Excel's two date systems. */
const SERIAL_1900 = 45322
const SERIAL_1904 = SERIAL_1900 - 1462

function workbookFile(rows: unknown[][], { format = 'm/d/yy', date1904 = false } = {}): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows, { dense: false })
  for (const [address, cell] of Object.entries(sheet)) {
    if (!address.startsWith('!') && (cell as XLSX.CellObject).t === 'n') {
      ;(cell as XLSX.CellObject).z = format
    }
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'People')
  workbook.Workbook = { WBProps: { date1904 } }
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return new File([bytes], 'people.xlsx')
}

describe('readPeopleSheet', () => {
  it.each(['m/d/yy', 'dd/mm/yyyy', 'yyyy-mm-dd'])(
    'reads a date cell formatted %s as its calendar date, not its displayed text',
    async (format) => {
      const sheet = await readPeopleSheet(
        workbookFile(
          [
            ['email', 'start date'],
            ['ada@example.com', SERIAL_1900],
          ],
          { format }
        )
      )
      expect(sheet.rows).toEqual([['ada@example.com', '2024-01-31']])
    }
  )

  it('reads dates from a workbook saved in the 1904 date system', async () => {
    const sheet = await readPeopleSheet(
      workbookFile(
        [
          ['email', 'start date'],
          ['ada@example.com', SERIAL_1904],
        ],
        { date1904: true }
      )
    )
    expect(sheet.rows).toEqual([['ada@example.com', '2024-01-31']])
  })

  it('keeps blank rows in place so issue row numbers match the sheet', async () => {
    const sheet = await readPeopleSheet(
      workbookFile([
        ['email', 'title'],
        ['ada@example.com', 'Engineer'],
        [],
        ['bo@example.com', 'Lead'],
      ])
    )
    expect(sheet.rows).toEqual([
      ['ada@example.com', 'Engineer'],
      ['', ''],
      ['bo@example.com', 'Lead'],
    ])
  })

  it('refuses a header row that repeats a column name', async () => {
    await expect(
      readPeopleSheet(
        workbookFile([
          ['email', 'title', 'title'],
          ['ada@example.com', 'a', 'b'],
        ])
      )
    ).rejects.toThrow('The title column appears more than once')
  })
})
