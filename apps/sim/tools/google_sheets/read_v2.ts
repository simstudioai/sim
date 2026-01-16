import type {
  GoogleSheetsV2ReadResponse,
  GoogleSheetsV2ToolParams,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const readV2Tool: ToolConfig<GoogleSheetsV2ToolParams, GoogleSheetsV2ReadResponse> = {
  id: 'google_sheets_read_v2',
  name: 'Read from Google Sheets V2',
  description: 'Read data from a specific sheet in a Google Sheets spreadsheet',
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
      visibility: 'user-only',
      description: 'The ID of the spreadsheet',
    },
    sheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the sheet/tab to read from',
    },
    cellRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The cell range to read (e.g. "A1:D10"). Defaults to "A1:Z1000" if not specified.',
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

      const cellRange = params.cellRange?.trim() || 'A1:Z1000'
      const fullRange = `${sheetName}!${cellRange}`

      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(fullRange)}`
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

  transformResponse: async (response: Response, params?: GoogleSheetsV2ToolParams) => {
    const data = await response.json()

    const urlParts = typeof response.url === 'string' ? response.url.split('/spreadsheets/') : []
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    const metadata = {
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }

    return {
      success: true,
      output: {
        sheetName: params?.sheetName ?? '',
        range: data.range ?? '',
        values: data.values ?? [],
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }
  },

  outputs: {
    sheetName: { type: 'string', description: 'Name of the sheet that was read' },
    range: { type: 'string', description: 'The range of cells that was read' },
    values: { type: 'array', description: 'The cell values as a 2D array' },
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
