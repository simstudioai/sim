import type {
  GoogleSheetsV2ClearParams,
  GoogleSheetsV2ClearResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const clearV2Tool: ToolConfig<GoogleSheetsV2ClearParams, GoogleSheetsV2ClearResponse> = {
  id: 'google_sheets_clear_v2',
  name: 'Clear Google Sheets Range V2',
  description: 'Clear values from a specific range in a Google Sheets spreadsheet',
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
    sheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the sheet/tab to clear',
    },
    cellRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The cell range to clear (e.g. "A1:D10"). Clears entire sheet if not specified.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      const sheetName = params.sheetName?.trim()
      if (!sheetName) {
        throw new Error('Sheet name is required')
      }

      const cellRange = params.cellRange?.trim()
      const fullRange = cellRange ? `${sheetName}!${cellRange}` : sheetName

      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(fullRange)}:clear`
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
    body: () => ({}),
  },

  transformResponse: async (response: Response, params?: GoogleSheetsV2ClearParams) => {
    const data = await response.json()

    const spreadsheetId = params?.spreadsheetId ?? ''
    const metadata = {
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }

    return {
      success: true,
      output: {
        clearedRange: data.clearedRange ?? '',
        sheetName: params?.sheetName ?? '',
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }
  },

  outputs: {
    clearedRange: { type: 'string', description: 'The range that was cleared' },
    sheetName: { type: 'string', description: 'Name of the sheet that was cleared' },
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
