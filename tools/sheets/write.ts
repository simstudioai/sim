import { ToolConfig } from '../types'
import { GoogleSheetsToolParams, GoogleSheetsWriteResponse } from './types'

export const writeTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsWriteResponse> = {
  id: 'google_sheets_write',
  name: 'Write to Google Sheets',
  description: 'Write data to a Google Sheets spreadsheet',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'google-sheets',
    additionalScopes: ['https://www.googleapis.com/auth/spreadsheets'],
  },
  params: {
    accessToken: { type: 'string', required: true },
    spreadsheetId: { type: 'string', required: true },
    range: { type: 'string', required: false },
    values: { type: 'array', required: true },
    valueInputOption: { type: 'string', required: false },
    includeValuesInResponse: { type: 'boolean', required: false },
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
      const error = await response.json()
      throw new Error(error.error?.message || 'Failed to write data to Google Sheets')
    }

    const data = await response.json()

    // Get spreadsheet metadata
    const spreadsheetId = response.url.split('/spreadsheets/')[1].split('/values/')[0]
    const metadataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`,
      {
        headers: {
          Authorization: response.headers.get('Authorization') || '',
        },
      }
    )

    const metadata = await metadataResponse.json()

    return {
      success: true,
      output: {
        updatedRange: data.updatedRange,
        updatedRows: data.updatedRows,
        updatedColumns: data.updatedColumns,
        updatedCells: data.updatedCells,
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${metadata.spreadsheetId}`,
          title: metadata.properties?.title,
          sheets: metadata.sheets?.map((sheet: any) => ({
            sheetId: sheet.properties.sheetId,
            title: sheet.properties.title,
            index: sheet.properties.index,
            rowCount: sheet.properties.gridProperties?.rowCount,
            columnCount: sheet.properties.gridProperties?.columnCount,
          })),
        },
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while writing to Google Sheets'
  },
}
