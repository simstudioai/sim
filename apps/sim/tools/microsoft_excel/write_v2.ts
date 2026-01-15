import type {
  MicrosoftExcelV2ToolParams,
  MicrosoftExcelV2WriteResponse,
} from '@/tools/microsoft_excel/types'
import { getSpreadsheetWebUrl } from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

export const writeV2Tool: ToolConfig<MicrosoftExcelV2ToolParams, MicrosoftExcelV2WriteResponse> = {
  id: 'microsoft_excel_write_v2',
  name: 'Write to Microsoft Excel V2',
  description: 'Write data to a specific sheet in a Microsoft Excel spreadsheet',
  version: '2.0.0',

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
      visibility: 'user-only',
      description: 'The ID of the spreadsheet to write to',
    },
    sheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the sheet/tab to write to',
    },
    cellRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The cell range to write to (e.g., "A1:D10", "A1"). Defaults to "A1" if not specified.',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The data to write as a 2D array (e.g. [["Name", "Age"], ["Alice", 30], ["Bob", 25]]) or array of objects.',
    },
    valueInputOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The format of the data to write',
    },
    includeValuesInResponse: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Whether to include the written values in the response',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      const sheetName = params.sheetName?.trim()
      if (!sheetName) {
        throw new Error('Sheet name is required')
      }

      const cellRange = params.cellRange?.trim() || 'A1'
      const encodedSheetName = encodeURIComponent(sheetName)
      const encodedAddress = encodeURIComponent(cellRange)

      const url = new URL(
        `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodedSheetName}')/range(address='${encodedAddress}')`
      )

      const valueInputOption = params.valueInputOption || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)

      if (params.includeValuesInResponse) {
        url.searchParams.append('includeValuesInResponse', 'true')
      }

      return url.toString()
    },
    method: 'PATCH',
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
        const allKeys = new Set<string>()
        processedValues.forEach((obj: any) => {
          if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach((key) => allKeys.add(key))
          }
        })
        const headers = Array.from(allKeys)

        const rows = processedValues.map((obj: any) => {
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

        processedValues = [headers, ...rows]
      }

      const body: Record<string, any> = {
        majorDimension: params.majorDimension || 'ROWS',
        values: processedValues,
      }

      return body
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftExcelV2ToolParams) => {
    const data = await response.json()

    const urlParts = response.url.split('/drive/items/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

    return {
      success: true,
      output: {
        updatedRange: data.address ?? null,
        updatedRows: data.rowCount ?? 0,
        updatedColumns: data.columnCount ?? 0,
        updatedCells: (data.rowCount ?? 0) * (data.columnCount ?? 0),
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    updatedRange: { type: 'string', description: 'Range of cells that were updated' },
    updatedRows: { type: 'number', description: 'Number of rows updated' },
    updatedColumns: { type: 'number', description: 'Number of columns updated' },
    updatedCells: { type: 'number', description: 'Number of cells updated' },
    metadata: {
      type: 'json',
      description: 'Spreadsheet metadata including ID and URL',
      properties: {
        spreadsheetId: { type: 'string', description: 'Microsoft Excel spreadsheet ID' },
        spreadsheetUrl: { type: 'string', description: 'Spreadsheet URL' },
      },
    },
  },
}
