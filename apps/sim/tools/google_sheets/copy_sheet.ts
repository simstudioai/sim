import type {
  GoogleSheetsV2CopySheetParams,
  GoogleSheetsV2CopySheetResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const copySheetV2Tool: ToolConfig<
  GoogleSheetsV2CopySheetParams,
  GoogleSheetsV2CopySheetResponse
> = {
  id: 'google_sheets_copy_sheet_v2',
  name: 'Copy Sheet V2',
  description: 'Copy a sheet from one spreadsheet to another',
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
    sourceSpreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source Google Sheets spreadsheet ID',
    },
    sheetId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the sheet to copy (numeric ID, not the sheet name). Use Get Spreadsheet to find sheet IDs.',
    },
    destinationSpreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the destination spreadsheet where the sheet will be copied',
    },
  },

  request: {
    url: (params) => {
      const sourceSpreadsheetId = params.sourceSpreadsheetId?.trim()
      if (!sourceSpreadsheetId) {
        throw new Error('Source spreadsheet ID is required')
      }

      const sheetId = params.sheetId
      if (sheetId === undefined || sheetId === null) {
        throw new Error('Sheet ID is required')
      }

      return `https://sheets.googleapis.com/v4/spreadsheets/${sourceSpreadsheetId}/sheets/${sheetId}:copyTo`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const destinationSpreadsheetId = params.destinationSpreadsheetId?.trim()
      if (!destinationSpreadsheetId) {
        throw new Error('Destination spreadsheet ID is required')
      }

      return {
        destinationSpreadsheetId,
      }
    },
  },

  transformResponse: async (response: Response, params?: GoogleSheetsV2CopySheetParams) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        sheetId: data.sheetId ?? 0,
        title: data.title ?? '',
        index: data.index ?? 0,
        sheetType: data.sheetType ?? 'GRID',
        destinationSpreadsheetId: params?.destinationSpreadsheetId ?? '',
        destinationSpreadsheetUrl: `https://docs.google.com/spreadsheets/d/${params?.destinationSpreadsheetId ?? ''}`,
      },
    }
  },

  outputs: {
    sheetId: {
      type: 'number',
      description: 'The ID of the newly created sheet in the destination',
    },
    title: { type: 'string', description: 'The title of the copied sheet' },
    index: { type: 'number', description: 'The index (position) of the copied sheet' },
    sheetType: { type: 'string', description: 'The type of the sheet (GRID, CHART, etc.)' },
    destinationSpreadsheetId: {
      type: 'string',
      description: 'The ID of the destination spreadsheet',
    },
    destinationSpreadsheetUrl: {
      type: 'string',
      description: 'URL to the destination spreadsheet',
    },
  },
}
