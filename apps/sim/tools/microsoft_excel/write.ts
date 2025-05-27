import type { ToolConfig } from '../types'
import type { MicrosoftExcelToolParams, MicrosoftExcelWriteResponse } from './types'

export const writeTool: ToolConfig<MicrosoftExcelToolParams, MicrosoftExcelWriteResponse> = {
  id: 'microsoft_excel_write',
  name: 'Write to Microsoft Excel',
  description: 'Write data to a Microsoft Excel spreadsheet',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'microsoft-excel',
    additionalScopes: [],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Microsoft Excel API',
    },
    spreadsheetId: {
      type: 'string',
      required: true,
      description: 'The ID of the spreadsheet to write to',
    },
    range: { type: 'string', required: false, description: 'The range of cells to write to' },
    values: { type: 'array', required: true, description: 'The data to write to the spreadsheet' },
    valueInputOption: {
      type: 'string',
      required: false,
      description: 'The format of the data to write',
    },
    includeValuesInResponse: {
      type: 'boolean',
      required: false,
      description: 'Whether to include the written values in the response',
    },
  },
  request: {
    url: (params) => {
      // If range is not provided, use a default range for the first sheet, second row to preserve headers
      const rangeInput = params.range?.trim()
      const match = rangeInput?.match(/^([^!]+)!(.+)$/)
    
      if (!match) {
        throw new Error(
          `Invalid range format: "${params.range}". Use the format "Sheet1!A1:B2"`
        )
      }
    
      const sheetName = encodeURIComponent(match[1])
      const address = encodeURIComponent(match[2])

      const url = new URL(
        `https://graph.microsoft.com/v1.0/me/drive/items/${params.spreadsheetId}/workbook/worksheets('${sheetName}')/range(address='${address}')`
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
      let processedValues: any = params.values || []

      // Handle array of objects
      if (
        Array.isArray(processedValues) &&
        processedValues.length > 0 &&
        typeof processedValues[0] === 'object' &&
        !Array.isArray(processedValues[0])
      ) {
        // It's an array of objects

        // First, extract all unique keys from all objects to create headers
        const allKeys = new Set<string>()
        processedValues.forEach((obj: any) => {
          if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach((key) => allKeys.add(key))
          }
        })
        const headers = Array.from(allKeys)

        // Then create rows with object values in the order of headers
        const rows = processedValues.map((obj: any) => {
          if (!obj || typeof obj !== 'object') {
            // Handle non-object items by creating an array with empty values
            return Array(headers.length).fill('')
          }
          return headers.map((key) => {
            const value = obj[key]
            // Handle nested objects/arrays by converting to JSON string
            if (value !== null && typeof value === 'object') {
              return JSON.stringify(value)
            }
            return value === undefined ? '' : value
          })
        })

        // Add headers as the first row, then add data rows
        processedValues = [headers, ...rows]
      }

      const body: Record<string, any> = {
        majorDimension: params.majorDimension || 'ROWS',
        values: processedValues,
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
      throw new Error(`Failed to write data to Microsoft Excel: ${errorText}`)
    }

    const data = await response.json()

    // Extract spreadsheet ID from the URL
    const urlParts = response.url.split('/drive/items/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    // Create a simple metadata object with just the ID and URL
    const metadata = {
      spreadsheetId,
      properties: {},
      spreadsheetUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`,
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
    return 'An error occurred while writing to Microsoft Excel'
  },
}
