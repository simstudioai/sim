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
    additionalScopes: ['https://www.googleapis.com/auth/spreadsheets'],
  },
  params: {
    accessToken: { type: 'string', required: true },
    spreadsheetId: { type: 'string', required: true },
    range: { type: 'string', required: false },
  },
  request: {
    url: (params) => {
      // If no range is provided, get all values from the first sheet
      if (!params.range) {
        return `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/Sheet1!A1:Z1000`
      }

      // Otherwise, get values from the specified range
      return `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(params.range)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Failed to read data from Google Sheets')
    }

    const data = await response.json()

    // Extract spreadsheet ID from URL
    const urlParts = response.url.split('/spreadsheets/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    // Get metadata separately
    let metadata
    try {
      const metadataResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`,
        {
          headers: {
            Authorization: response.headers.get('Authorization') || '',
          },
        }
      )

      if (metadataResponse.ok) {
        metadata = await metadataResponse.json()
      } else {
        console.error('Failed to get metadata, using fallback')
        metadata = {
          spreadsheetId,
          properties: { title: 'Unknown' },
          sheets: [],
        }
      }
    } catch (error) {
      console.error('Error fetching metadata:', error)
      metadata = {
        spreadsheetId,
        properties: { title: 'Unknown' },
        sheets: [],
      }
    }

    // Process the values response
    return {
      success: true,
      output: {
        data: {
          range: data.range || '',
          values: data.values || [],
        },
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          title: metadata.properties?.title,
          sheets:
            metadata.sheets?.map((sheet: any) => ({
              sheetId: sheet.properties.sheetId,
              title: sheet.properties.title,
              index: sheet.properties.index,
              rowCount: sheet.properties.gridProperties?.rowCount,
              columnCount: sheet.properties.gridProperties?.columnCount,
            })) || [],
        },
      },
    }
  },
  transformError: (error) => {
    return error.message || 'An error occurred while reading from Google Sheets'
  },
}
