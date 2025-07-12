import type { ToolConfig } from '../types'
import type { GoogleSheetsReadResponse, GoogleSheetsToolParams } from './types'

export const readTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsReadResponse> = {
  id: 'google_sheets_read',
  name: 'Read from Google Sheets',
  description: 'Read data from a Google Sheets spreadsheet',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-sheets',
    additionalScopes: ['https://www.googleapis.com/auth/spreadsheets'],
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
      const errorJson = await response.json().catch(() => ({ error: response.statusText }))
      const errorText =
        errorJson.error && typeof errorJson.error === 'object'
          ? errorJson.error.message || JSON.stringify(errorJson.error)
          : errorJson.error || response.statusText
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
    // If it's an Error instance with a message, use that
    if (error instanceof Error) {
      return error.message
    }

    // If it's an object with an error or message property
    if (typeof error === 'object' && error !== null) {
      // Handle Google API error response format
      if (error.error) {
        if (typeof error.error === 'string') {
          return error.error
        }
        // Google API often returns error objects with error.error.message
        if (typeof error.error === 'object' && error.error.message) {
          return error.error.message
        }
        // If error.error is an object but doesn't have a message property
        return JSON.stringify(error.error)
      }

      if (error.message) {
        return error.message
      }

      // If we have a complex object, stringify it for debugging
      try {
        return `Google Sheets API error: ${JSON.stringify(error)}`
      } catch (_e) {
        // In case the error object can't be stringified (e.g., circular references)
        return 'Google Sheets API error: Unable to parse error details'
      }
    }

    // Default fallback message
    return 'An error occurred while reading from Google Sheets'
  },
}
