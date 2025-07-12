import type { ToolConfig } from '../types'
import type { MicrosoftExcelTableAddResponse, MicrosoftExcelTableToolParams } from './types'

export const tableAddTool: ToolConfig<
  MicrosoftExcelTableToolParams,
  MicrosoftExcelTableAddResponse
> = {
  id: 'microsoft_excel_table_add',
  name: 'Add to Microsoft Excel Table',
  description: 'Add new rows to a Microsoft Excel table',
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
      visibility: 'hidden',
      description: 'The access token for the Microsoft Excel API',
    },
    spreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the spreadsheet containing the table',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the table to add rows to',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'The data to add to the table (array of arrays or array of objects)',
    },
  },
  request: {
    url: (params) => {
      const tableName = encodeURIComponent(params.tableName)
      return `https://graph.microsoft.com/v1.0/me/drive/items/${params.spreadsheetId}/workbook/tables('${tableName}')/rows/add`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let processedValues: any = params.values || []

      if (
        Array.isArray(processedValues) &&
        processedValues.length > 0 &&
        typeof processedValues[0] === 'object' &&
        !Array.isArray(processedValues[0])
      ) {
        const allKeys = new Set<string>()
        processedValues.forEach((obj: any) => {
          if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach((key) => allKeys.add(key))
          }
        })
        const headers = Array.from(allKeys)

        processedValues = processedValues.map((obj: any) => {
          if (!obj || typeof obj !== 'object') {
            return Array(headers.length).fill('')
          }
          return headers.map((key) => {
            const value = obj[key]
            if (value !== null && typeof value === 'object') {
              return JSON.stringify(value)
            }
            return value === undefined ? '' : value
          })
        })
      }

      if (!Array.isArray(processedValues) || processedValues.length === 0) {
        throw new Error('Values must be a non-empty array')
      }

      if (!Array.isArray(processedValues[0])) {
        processedValues = [processedValues]
      }

      return {
        values: processedValues,
      }
    },
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to add rows to Microsoft Excel table: ${errorText}`)
    }

    const data = await response.json()

    const urlParts = response.url.split('/drive/items/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    const metadata = {
      spreadsheetId,
      spreadsheetUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`,
    }

    const result = {
      success: true,
      output: {
        index: data.index || 0,
        values: data.values || [],
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }

    return result
  },
  transformError: (error) => {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        return typeof error.error === 'string' ? error.error : JSON.stringify(error.error)
      }
      if (error.message) {
        return error.message
      }
    }

    return 'An error occurred while adding rows to Microsoft Excel table'
  },
}
