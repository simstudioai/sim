import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface GoogleSheetsV2DeleteRowsParams {
  accessToken: string
  spreadsheetId: string
  sheetId: number
  startIndex: number
  endIndex: number
}

export interface GoogleSheetsV2DeleteRowsResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    sheetId: number
    deletedRowRange: string
    metadata: {
      spreadsheetId: string
      spreadsheetUrl: string
    }
  }
}

export const deleteRowsV2Tool: ToolConfig<
  GoogleSheetsV2DeleteRowsParams,
  GoogleSheetsV2DeleteRowsResponse
> = {
  id: 'google_sheets_delete_rows_v2',
  name: 'Delete Rows from Google Sheets V2',
  description: 'Delete rows from a sheet in a Google Sheets spreadsheet',
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
        'The numeric ID of the sheet/tab (not the sheet name). Use Get Spreadsheet to find sheet IDs.',
    },
    startIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The start row index (0-based, inclusive) of the rows to delete',
    },
    endIndex: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end row index (0-based, exclusive) of the rows to delete',
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
      if (params.startIndex === undefined || params.startIndex === null) {
        throw new Error('Start index is required')
      }
      if (params.endIndex === undefined || params.endIndex === null) {
        throw new Error('End index is required')
      }

      return {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: params.sheetId,
                dimension: 'ROWS',
                startIndex: params.startIndex,
                endIndex: params.endIndex,
              },
            },
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params?: GoogleSheetsV2DeleteRowsParams) => {
    await response.json()

    const spreadsheetId = params?.spreadsheetId ?? ''
    const startIndex = params?.startIndex ?? 0
    const endIndex = params?.endIndex ?? 0

    return {
      success: true,
      output: {
        spreadsheetId,
        sheetId: params?.sheetId ?? 0,
        deletedRowRange: `rows ${startIndex} to ${endIndex}`,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        },
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'Google Sheets spreadsheet ID' },
    sheetId: { type: 'number', description: 'The numeric ID of the sheet' },
    deletedRowRange: {
      type: 'string',
      description: 'Description of the deleted row range',
    },
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
