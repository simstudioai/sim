import { ToolConfig } from '../types'
import { GoogleSheetsAppendResponse, GoogleSheetsToolParams } from './types'

export const appendTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsAppendResponse> = {
  id: 'google_sheets_append',
  name: 'Append to Google Sheets',
  description: 'Append data to the end of a Google Sheets spreadsheet',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-sheets',
    additionalScopes: ['https://www.googleapis.com/auth/spreadsheets'],
  },
  params: {
    accessToken: { type: 'string', required: true, description: 'The access token for the Google Sheets API' },
    spreadsheetId: { type: 'string', required: true, description: 'The ID of the spreadsheet to append to' },
    range: { type: 'string', required: false, description: 'The range of cells to append after' },
    values: { type: 'array', required: true, description: 'The data to append to the spreadsheet' },
    valueInputOption: { type: 'string', required: false, description: 'The format of the data to append' },
    insertDataOption: { type: 'string', required: false, description: 'How to insert the data (OVERWRITE or INSERT_ROWS)' },
    includeValuesInResponse: { type: 'boolean', required: false, description: 'Whether to include the appended values in the response' },
  },
  request: {
    url: (params) => {
      // If range is not provided, use a default range for the first sheet
      const range = params.range || 'Sheet1'

      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(range)}:append`
      )

      // Default to USER_ENTERED if not specified
      const valueInputOption = params.valueInputOption || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)

      // Default to INSERT_ROWS if not specified
      if (params.insertDataOption) {
        url.searchParams.append('insertDataOption', params.insertDataOption)
      }

      if (params.includeValuesInResponse) {
        url.searchParams.append('includeValuesInResponse', 'true')
      }

      return url.toString()
    },
    method: 'POST',
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
      throw new Error(`Failed to append data to Google Sheets: ${errorText}`)
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
        tableRange: data.tableRange || '',
        updatedRange: data.updates?.updatedRange || '',
        updatedRows: data.updates?.updatedRows || 0,
        updatedColumns: data.updates?.updatedColumns || 0,
        updatedCells: data.updates?.updatedCells || 0,
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
    return 'An error occurred while appending to Google Sheets'
  },
} 