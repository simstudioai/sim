import type {
  MicrosoftExcelTableAddResponse,
  MicrosoftExcelTableToolParams,
} from '@/tools/microsoft_excel/types'
import { getItemBasePath, getSpreadsheetWebUrl } from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

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
      visibility: 'user-or-llm',
      description:
        'The ID of the spreadsheet/workbook containing the table (e.g., "01ABC123DEF456")',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses personal OneDrive.',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the table to add rows to (e.g., "Table1", "SalesTable")',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The data to add as a 2D array (e.g., [["Alice", 30], ["Bob", 25]]) or array of objects',
    },
  },

  request: {
    url: (params) => {
      const tableName = encodeURIComponent(params.tableName)
      const basePath = getItemBasePath(params.spreadsheetId, params.driveId)
      return `${basePath}/workbook/tables('${tableName}')/rows/add`
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

  transformResponse: async (response: Response, params?: MicrosoftExcelTableToolParams) => {
    const data = await response.json()

    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId)

    return {
      success: true,
      output: {
        index: data.index || 0,
        values: data.values || [],
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    index: { type: 'number', description: 'Index of the first row that was added' },
    values: { type: 'array', description: 'Array of rows that were added to the table' },
    metadata: {
      type: 'object',
      description: 'Spreadsheet metadata',
      properties: {
        spreadsheetId: { type: 'string', description: 'The ID of the spreadsheet' },
        spreadsheetUrl: { type: 'string', description: 'URL to access the spreadsheet' },
      },
    },
  },
}
