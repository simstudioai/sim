import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface GoogleSheetsV2DeleteSheetParams {
  accessToken: string
  spreadsheetId: string
  sheetId: number
}

export interface GoogleSheetsV2DeleteSheetResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    deletedSheetId: number
    metadata: {
      spreadsheetId: string
      spreadsheetUrl: string
    }
  }
}

export const deleteSheetV2Tool: ToolConfig<
  GoogleSheetsV2DeleteSheetParams,
  GoogleSheetsV2DeleteSheetResponse
> = {
  id: 'google_sheets_delete_sheet_v2',
  name: 'Delete Sheet V2',
  description: 'Delete a sheet/tab from a Google Sheets spreadsheet',
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
    sheetId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The numeric ID of the sheet/tab to delete (not the sheet name). Use Get Spreadsheet to find sheet IDs.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`
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
      if (params.sheetId === undefined || params.sheetId === null) {
        throw new Error('Sheet ID is required')
      }

      return {
        requests: [
          {
            deleteSheet: {
              sheetId: params.sheetId,
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params?: GoogleSheetsV2DeleteSheetParams) => {
    await response.json()

    const spreadsheetId = params?.spreadsheetId ?? ''

    return {
      success: true,
      output: {
        spreadsheetId,
        deletedSheetId: params?.sheetId ?? 0,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        },
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'Google Sheets spreadsheet ID' },
    deletedSheetId: { type: 'number', description: 'The numeric ID of the deleted sheet' },
    metadata: {
      type: 'json',
      description: 'Spreadsheet metadata including ID and URL',
      properties: {
        spreadsheetId: { type: 'string', description: 'Google Sheets spreadsheet ID' },
        spreadsheetUrl: { type: 'string', description: 'Spreadsheet URL' },
      },
    },
  },
}
