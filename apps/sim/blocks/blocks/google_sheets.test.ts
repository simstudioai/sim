import { describe, expect, it } from 'vitest'
import { GoogleSheetsV2Block } from '@/blocks/blocks/google_sheets'

/**
 * On an agent tool call the operation arrives only in `context`, and the model supplies args under
 * the tool's own param names with JSON params already parsed.
 */
describe('GoogleSheetsV2Block agent tool calls', () => {
  it.each([
    ['delete_sheet', { spreadsheetId: 'ss-1', sheetId: 42 }],
    ['delete_rows', { spreadsheetId: 'ss-1', sheetId: 42, startIndex: 0, endIndex: 3 }],
    ['copy_sheet', { sourceSpreadsheetId: 'ss-1', sheetId: 42, destinationSpreadsheetId: 'ss-2' }],
    ['batch_get', { spreadsheetId: 'ss-1', ranges: ['Sheet1!A1:B2'], majorDimension: 'COLUMNS' }],
    ['batch_update', { spreadsheetId: 'ss-1', data: [{ range: 'Sheet1!A1', values: [['x']] }] }],
    ['create', { title: 'Budget', sheetTitles: ['Q1', 'Q2'] }],
    ['read', { spreadsheetId: 'ss-1', sheetName: 'Sheet1', majorDimension: 'COLUMNS' }],
    [
      'append',
      { spreadsheetId: 'ss-1', sheetName: 'Sheet1', values: [['a']], valueInputOption: 'RAW' },
    ],
  ])('keeps the model args on %s', (operation, inputs) => {
    const mapped = GoogleSheetsV2Block.tools.config?.params?.(inputs, { operation })
    expect({ ...inputs, ...mapped }).toMatchObject(inputs)
  })
})
