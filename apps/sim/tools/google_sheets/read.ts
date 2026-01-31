import type {
  GoogleSheetsReadResponse,
  GoogleSheetsToolParams,
  GoogleSheetsV2ReadResponse,
  GoogleSheetsV2ToolParams,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const readTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsReadResponse> = {
  id: 'google_sheets_read',
  name: 'Read from Google Sheets',
  description: 'Read data from a Google Sheets spreadsheet',
  version: '1.0',

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
      description:
        'The ID of the spreadsheet (found in the URL: docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit).',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The A1 notation range to read (e.g. "Sheet1!A1:D10", "A1:B5"). Defaults to first sheet A1:Z1000 if not specified.',
    },
  },

  request: {
    url: (params) => {
      // Ensure spreadsheetId is valid
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      // If no range is provided, default to the first sheet without hardcoding the title
      // Using A1 notation without a sheet name targets the first sheet (per Sheets API)
      // Keep a generous column/row bound to avoid huge payloads
      if (!params.range) {
        const defaultRange = 'A1:Z1000'
        return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${defaultRange}`
      }

      // Otherwise, get values from the specified range
      return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(params.range)}`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
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

    // Extract spreadsheet ID from the URL (guard if url is missing)
    const urlParts = typeof response.url === 'string' ? response.url.split('/spreadsheets/') : []
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    // Create a simple metadata object with just the ID and URL
    const metadata = {
      spreadsheetId,
      properties: {},
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }

    // Process the values response
    const result: GoogleSheetsReadResponse = {
      success: true,
      output: {
        data: {
          range: data.range || '',
          values: data.values || [],
        },
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }

    return result
  },

  outputs: {
    data: { type: 'json', description: 'Sheet data including range and cell values' },
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
      visibility: 'user-or-llm',
      description: 'Google Sheets spreadsheet ID',
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
