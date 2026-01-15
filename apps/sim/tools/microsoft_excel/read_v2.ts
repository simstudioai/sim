import type {
  ExcelCellValue,
  MicrosoftExcelV2ReadResponse,
  MicrosoftExcelV2ToolParams,
} from '@/tools/microsoft_excel/types'
import {
  getSpreadsheetWebUrl,
  trimTrailingEmptyRowsAndColumns,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

export const readV2Tool: ToolConfig<MicrosoftExcelV2ToolParams, MicrosoftExcelV2ReadResponse> = {
  id: 'microsoft_excel_read_v2',
  name: 'Read from Microsoft Excel V2',
  description: 'Read data from a specific sheet in a Microsoft Excel spreadsheet',
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
      description: 'The ID of the spreadsheet to read from',
    },
    sheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the sheet/tab to read from',
    },
    cellRange: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The cell range to read (e.g., "A1:D10"). If not specified, reads the entire used range.',
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

      const encodedSheetName = encodeURIComponent(sheetName)

      // If no cell range specified, fetch usedRange
      if (!params.cellRange) {
        return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodedSheetName}')/usedRange(valuesOnly=true)`
      }

      const cellRange = params.cellRange.trim()
      const encodedAddress = encodeURIComponent(cellRange)

      return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('${encodedSheetName}')/range(address='${encodedAddress}')`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
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

    const address: string = data.address || data.addressLocal || ''
    const rawValues: ExcelCellValue[][] = data.values || []
    const values = trimTrailingEmptyRowsAndColumns(rawValues)

    // Extract sheet name from address (format: SheetName!A1:B2)
    const sheetName = params?.sheetName || address.split('!')[0] || ''

    return {
      success: true,
      output: {
        sheetName,
        range: address,
        values,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    sheetName: { type: 'string', description: 'Name of the sheet that was read' },
    range: { type: 'string', description: 'The range that was read' },
    values: { type: 'array', description: 'Array of rows containing cell values' },
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
