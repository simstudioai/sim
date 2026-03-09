import type {
  GoogleSheetsV2BatchGetParams,
  GoogleSheetsV2BatchGetResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const batchGetV2Tool: ToolConfig<
  GoogleSheetsV2BatchGetParams,
  GoogleSheetsV2BatchGetResponse
> = {
  id: 'google_sheets_batch_get_v2',
  name: 'Batch Read Google Sheets V2',
  description: 'Read multiple ranges from a Google Sheets spreadsheet in a single request',
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
        'Array of ranges to read (e.g., ["Sheet1!A1:D10", "Sheet2!A1:B5"]). Each range should include sheet name.',
    },
    majorDimension: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The major dimension of values: "ROWS" (default) or "COLUMNS"',
    },
    valueRenderOption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How values should be rendered: "FORMATTED_VALUE" (default), "UNFORMATTED_VALUE", or "FORMULA"',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      const ranges = params.ranges
      if (!ranges || !Array.isArray(ranges) || ranges.length === 0) {
        throw new Error('At least one range is required')
      }

      const queryParams = new URLSearchParams()
      ranges.forEach((range: string) => {
        queryParams.append('ranges', range)
      })

      if (params.majorDimension) {
        queryParams.append('majorDimension', params.majorDimension)
      }

      if (params.valueRenderOption) {
        queryParams.append('valueRenderOption', params.valueRenderOption)
      }

      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${queryParams.toString()}`
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

    const valueRanges =
      data.valueRanges?.map((vr: any) => ({
        range: vr.range ?? '',
        majorDimension: vr.majorDimension ?? 'ROWS',
        values: vr.values ?? [],
      })) ?? []

    const spreadsheetId = data.spreadsheetId ?? ''

    return {
      success: true,
      output: {
        spreadsheetId,
        valueRanges,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        },
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'The spreadsheet ID' },
    valueRanges: {
      type: 'array',
      description: 'Array of value ranges read from the spreadsheet',
      items: {
        type: 'object',
        properties: {
          range: { type: 'string', description: 'The range that was read' },
          majorDimension: { type: 'string', description: 'Major dimension (ROWS or COLUMNS)' },
          values: { type: 'array', description: 'The cell values as a 2D array' },
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
