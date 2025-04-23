import { ToolConfig } from '../types'
import { GoogleSheetsToolParams, GoogleSheetsUpdateResponse } from './types'

export const updateTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsUpdateResponse> = {
  id: 'google_sheets_update',
  name: 'Update Google Sheets',
  description: 'Update data in a Google Sheets spreadsheet',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-sheets',
    additionalScopes: ['https://www.googleapis.com/auth/spreadsheets'],
  },
  params: {
    accessToken: { type: 'string', required: true, description: 'The access token for the Google Sheets API' },
    spreadsheetId: { type: 'string', required: true, description: 'The ID of the spreadsheet to update' },
    range: { type: 'string', required: false, description: 'The range of cells to update' },
    values: { type: 'array', required: true, description: 'The data to update in the spreadsheet' },
    valueInputOption: { type: 'string', required: false, description: 'The format of the data to update' },
    includeValuesInResponse: { type: 'boolean', required: false, description: 'Whether to include the updated values in the response' },
  },
  request: {
    url: (params) => {
      // If range is not provided, use a default range for the first sheet, second row to preserve headers
      const range = params.range || 'Sheet1!A2'

      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(range)}`
      )

      // Default to USER_ENTERED if not specified
      const valueInputOption = params.valueInputOption || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)

      if (params.includeValuesInResponse) {
        url.searchParams.append('includeValuesInResponse', 'true')
      }

      return url.toString()
    },
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, any> = {
        majorDimension: params.majorDimension || 'ROWS',
        values: params.values || [],
      }

      // Only include range if it's provided
      if (params.range) {
        body.range = params.range
      }

      return body
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to update data in Google Sheets: ${errorText}`)
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

    const result = {
      success: true,
      output: {
        updatedRange: data.updatedRange,
        updatedRows: data.updatedRows,
        updatedColumns: data.updatedColumns,
        updatedCells: data.updatedCells,
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
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    // Default fallback message
    return 'An error occurred while updating Google Sheets'
  },
}
