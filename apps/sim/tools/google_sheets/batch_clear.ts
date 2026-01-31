import type {
  GoogleSheetsV2BatchClearParams,
  GoogleSheetsV2BatchClearResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const batchClearV2Tool: ToolConfig<
  GoogleSheetsV2BatchClearParams,
  GoogleSheetsV2BatchClearResponse
> = {
  id: 'google_sheets_batch_clear_v2',
  name: 'Batch Clear Google Sheets V2',
  description: 'Clear multiple ranges in a Google Sheets spreadsheet in a single request',
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
    ranges: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of ranges to clear (e.g., ["Sheet1!A1:D10", "Sheet2!A1:B5"]). Each range should include sheet name.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`
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
      const ranges = params.ranges
      if (!ranges || !Array.isArray(ranges) || ranges.length === 0) {
        throw new Error('At least one range is required')
      }

      return {
        ranges,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const spreadsheetId = data.spreadsheetId ?? ''
    const clearedRanges = data.clearedRanges ?? []

    return {
      success: true,
      output: {
        spreadsheetId,
        clearedRanges,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        },
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
    clearedRanges: {
      type: 'array',
      description: 'Array of ranges that were cleared',
      items: {
        type: 'string',
      },
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
