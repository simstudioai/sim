import { ToolConfig } from '../types'
import { GoogleSheetsReadResponse, GoogleSheetsToolParams } from './types'

export const readTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsReadResponse> = {
  id: 'google_sheets_read',
  name: 'Read from Google Sheets',
  description: 'Read data from a Google Sheets spreadsheet',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-sheets',
    additionalScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  },
  params: {
    accessToken: { type: 'string', required: true },
    spreadsheetId: { type: 'string', required: true },
    range: { type: 'string', required: false },
  },
  request: {
    url: (params) => {
      // Ensure spreadsheetId is valid
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      // If no range is provided, get all values from the first sheet
      if (!params.range) {
        return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:Z1000`
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
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to read Google Sheets data: ${errorText}`)
    }

    const data = await response.json()

    // Extract spreadsheet ID from the URL
    const urlParts = response.url.split('/spreadsheets/')
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
  transformError: (error) => {
    if (typeof error === 'object' && error !== null) {
      return JSON.stringify(error) || 'An error occurred while reading from Google Sheets'
    }
    return error.message || 'An error occurred while reading from Google Sheets'
  },
}
