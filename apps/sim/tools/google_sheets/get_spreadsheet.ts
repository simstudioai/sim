import type {
  GoogleSheetsV2GetSpreadsheetParams,
  GoogleSheetsV2GetSpreadsheetResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const getSpreadsheetV2Tool: ToolConfig<
  GoogleSheetsV2GetSpreadsheetParams,
  GoogleSheetsV2GetSpreadsheetResponse
> = {
  id: 'google_sheets_get_spreadsheet_v2',
  name: 'Get Spreadsheet Info V2',
  description: 'Get metadata about a Google Sheets spreadsheet including title and sheet list',
  version: '2.0.0',

  oauth: {
    required: true,
    provider: 'google-sheets',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Sheets API',
    },
    spreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Sheets spreadsheet ID',
    },
    includeGridData: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include grid data (cell values). Defaults to false.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      const includeGridData = params.includeGridData ? 'true' : 'false'
      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=${includeGridData}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const sheets =
      data.sheets?.map((sheet: any) => ({
        sheetId: sheet.properties?.sheetId ?? 0,
        title: sheet.properties?.title ?? '',
        index: sheet.properties?.index ?? 0,
        rowCount: sheet.properties?.gridProperties?.rowCount ?? null,
        columnCount: sheet.properties?.gridProperties?.columnCount ?? null,
        hidden: sheet.properties?.hidden ?? false,
      })) ?? []

    return {
      success: true,
      output: {
        spreadsheetId: data.spreadsheetId ?? '',
        title: data.properties?.title ?? '',
        locale: data.properties?.locale ?? null,
        timeZone: data.properties?.timeZone ?? null,
        spreadsheetUrl: data.spreadsheetUrl ?? '',
        sheets,
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
    title: { type: 'string', description: 'The title of the spreadsheet' },
    locale: { type: 'string', description: 'The locale of the spreadsheet', optional: true },
    timeZone: { type: 'string', description: 'The time zone of the spreadsheet', optional: true },
    spreadsheetUrl: { type: 'string', description: 'URL to the spreadsheet' },
    sheets: {
      type: 'array',
      description: 'List of sheets in the spreadsheet',
      items: {
        type: 'object',
        properties: {
          sheetId: { type: 'number', description: 'The sheet ID' },
          title: { type: 'string', description: 'The sheet title/name' },
          index: { type: 'number', description: 'The sheet index (position)' },
          rowCount: { type: 'number', description: 'Number of rows in the sheet' },
          columnCount: { type: 'number', description: 'Number of columns in the sheet' },
          hidden: { type: 'boolean', description: 'Whether the sheet is hidden' },
        },
      },
    },
  },
}
