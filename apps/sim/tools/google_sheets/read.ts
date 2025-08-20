import type { GoogleSheetsReadResponse, GoogleSheetsToolParams } from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const readTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsReadResponse> = {
  id: 'google_sheets_read',
  name: 'Read from Google Sheets',
  description: 'Read data from a Google Sheets spreadsheet',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-sheets',
    additionalScopes: [],
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
      description: 'The ID of the spreadsheet to read from',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The range of cells to read from',
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
    metadata: { type: 'json', description: 'Spreadsheet metadata including ID and URL' },
  },
}
