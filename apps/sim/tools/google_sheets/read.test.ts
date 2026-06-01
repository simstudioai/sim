/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readV2Tool } from '@/tools/google_sheets/read'
import type { GoogleSheetsV2ToolParams } from '@/tools/google_sheets/types'

const SPREADSHEET_ID = 'abc123'
const URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Sheet1!A1:Z1000`

const SHEET_DATA = {
  range: 'Sheet1!A1:D4',
  values: [
    ['Name', 'Status'],
    ['Alice', 'Active'],
    ['Bob', 'Closed'],
  ],
}

function mockResponse(body: unknown, url = URL): Response {
  // double-cast-allowed: lightweight Response stub for transformResponse unit test
  return { url, json: async () => body } as unknown as Response
}

const baseParams: GoogleSheetsV2ToolParams = {
  accessToken: 'token',
  spreadsheetId: SPREADSHEET_ID,
  sheetName: 'Sheet1',
}

describe('readV2Tool.transformResponse', () => {
  it('returns values untouched and omits the filter field when no filter is requested', async () => {
    const result = await readV2Tool.transformResponse!(mockResponse(SHEET_DATA), baseParams)

    expect(result.output.values).toEqual(SHEET_DATA.values)
    expect('filter' in result.output).toBe(false)
    expect(result.output.range).toBe(SHEET_DATA.range)
    expect(result.output.metadata.spreadsheetId).toBe(SPREADSHEET_ID)
  })

  it('omits the filter field when filterColumn is set but filterValue is empty', async () => {
    const result = await readV2Tool.transformResponse!(mockResponse(SHEET_DATA), {
      ...baseParams,
      filterColumn: 'Status',
      filterValue: '',
    })

    expect('filter' in result.output).toBe(false)
    expect(result.output.values).toEqual(SHEET_DATA.values)
  })

  it('filters rows and reports filter metadata when a filter is applied', async () => {
    const result = await readV2Tool.transformResponse!(mockResponse(SHEET_DATA), {
      ...baseParams,
      filterColumn: 'Status',
      filterValue: 'Active',
      filterMatchType: 'exact',
    })

    expect(result.output.values).toEqual([
      ['Name', 'Status'],
      ['Alice', 'Active'],
    ])
    expect(result.output.filter).toEqual({
      applied: true,
      column: 'Status',
      matchType: 'exact',
      columnFound: true,
      matchedRows: 1,
      totalRows: 2,
    })
  })

  it('leaves values unchanged and reports columnFound=false when the column is missing', async () => {
    const result = await readV2Tool.transformResponse!(mockResponse(SHEET_DATA), {
      ...baseParams,
      filterColumn: 'Nonexistent',
      filterValue: 'x',
    })

    expect(result.output.values).toEqual(SHEET_DATA.values)
    expect(result.output.filter?.columnFound).toBe(false)
    expect(result.output.filter?.applied).toBe(false)
    expect(result.output.filter?.matchedRows).toBe(0)
  })

  it('handles a response with no values array', async () => {
    const result = await readV2Tool.transformResponse!(mockResponse({ range: 'Sheet1!A1' }), {
      ...baseParams,
      filterColumn: 'Status',
      filterValue: 'Active',
    })

    expect(result.output.values).toEqual([])
    expect(result.output.filter?.applied).toBe(false)
  })
})
