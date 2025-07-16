import type { ToolConfig } from '../types'
import type { GoogleSheetsAppendResponse, GoogleSheetsToolParams } from './types'

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
      description: 'The ID of the spreadsheet to append to',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The range of cells to append after',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'The data to append to the spreadsheet',
    },
    valueInputOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The format of the data to append',
    },
    insertDataOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'How to insert the data (OVERWRITE or INSERT_ROWS)',
    },
    includeValuesInResponse: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Whether to include the appended values in the response',
    },
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
      let processedValues: any = params.values || []

      // Handle case where values might be a string (potentially JSON string)
      if (typeof processedValues === 'string') {
        try {
          // Try to parse it as JSON
          processedValues = JSON.parse(processedValues)
        } catch (_error) {
          // If the input contains literal newlines causing JSON parse to fail,
          // try a more robust approach
          try {
            // Replace literal newlines with escaped newlines for JSON parsing
            const sanitizedInput = (processedValues as string)
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t')
              // Fix any double backslashes that might occur
              .replace(/\\\\/g, '\\')

            // Try to parse again with sanitized input
            processedValues = JSON.parse(sanitizedInput)
          } catch (_secondError) {
            // If all parsing attempts fail, wrap as a single cell value
            processedValues = [[processedValues]]
          }
        }
      }

      // New logic to handle array of objects
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
      // Continue with existing logic for other array types
      else if (!Array.isArray(processedValues)) {
        processedValues = [[String(processedValues)]]
      } else if (!processedValues.every((item: any) => Array.isArray(item))) {
        // If it's an array but not all elements are arrays, wrap each element
        processedValues = (processedValues as any[]).map((row: any) =>
          Array.isArray(row) ? row : [String(row)]
        )
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
