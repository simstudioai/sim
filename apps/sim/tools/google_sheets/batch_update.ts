import type {
  GoogleSheetsV2BatchUpdateParams,
  GoogleSheetsV2BatchUpdateResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const batchUpdateV2Tool: ToolConfig<
  GoogleSheetsV2BatchUpdateParams,
  GoogleSheetsV2BatchUpdateResponse
> = {
  id: 'google_sheets_batch_update_v2',
  name: 'Batch Update Google Sheets V2',
  description: 'Update multiple ranges in a Google Sheets spreadsheet in a single request',
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
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of value ranges to update. Each item should have "range" (e.g., "Sheet1!A1:D10") and "values" (2D array).',
    },
    valueInputOption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How input data should be interpreted: "RAW" or "USER_ENTERED" (default). USER_ENTERED parses formulas.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`
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
      const data = params.data
      if (!data || !Array.isArray(data) || data.length === 0) {
        throw new Error('At least one data range is required')
      }

      return {
        valueInputOption: params.valueInputOption ?? 'USER_ENTERED',
        data: data.map((item: any) => ({
          range: item.range,
          values: item.values,
        })),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const responses =
      data.responses?.map((r: any) => ({
        spreadsheetId: r.spreadsheetId ?? '',
        updatedRange: r.updatedRange ?? '',
        updatedRows: r.updatedRows ?? 0,
        updatedColumns: r.updatedColumns ?? 0,
        updatedCells: r.updatedCells ?? 0,
      })) ?? []

    const spreadsheetId = data.spreadsheetId ?? ''

    return {
      success: true,
      output: {
        spreadsheetId,
        totalUpdatedRows: data.totalUpdatedRows ?? 0,
        totalUpdatedColumns: data.totalUpdatedColumns ?? 0,
        totalUpdatedCells: data.totalUpdatedCells ?? 0,
        totalUpdatedSheets: data.totalUpdatedSheets ?? 0,
        responses,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        },
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
    totalUpdatedRows: { type: 'number', description: 'Total number of rows updated' },
    totalUpdatedColumns: { type: 'number', description: 'Total number of columns updated' },
    totalUpdatedCells: { type: 'number', description: 'Total number of cells updated' },
    totalUpdatedSheets: { type: 'number', description: 'Total number of sheets updated' },
    responses: {
      type: 'array',
      description: 'Array of update responses for each range',
      items: {
        type: 'object',
        properties: {
          spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
          updatedRange: { type: 'string', description: 'The range that was updated' },
          updatedRows: { type: 'number', description: 'Number of rows updated in this range' },
          updatedColumns: {
            type: 'number',
            description: 'Number of columns updated in this range',
          },
          updatedCells: { type: 'number', description: 'Number of cells updated in this range' },
        },
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
