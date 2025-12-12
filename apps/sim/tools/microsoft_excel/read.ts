import type {
  ExcelCellValue,
  MicrosoftExcelReadResponse,
  MicrosoftExcelToolParams,
} from '@/tools/microsoft_excel/types'
import {
  getSpreadsheetWebUrl,
  trimTrailingEmptyRowsAndColumns,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

export const readTool: ToolConfig<MicrosoftExcelToolParams, MicrosoftExcelReadResponse> = {
  id: 'microsoft_excel_read',
  name: 'Read from Microsoft Excel',
  description: 'Read data from a Microsoft Excel spreadsheet',
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
      visibility: 'user-only',
      description: 'The ID of the spreadsheet to read from',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The range of cells to read from. Accepts "SheetName!A1:B2" for explicit ranges or just "SheetName" to read the used range of that sheet. If omitted, reads the used range of the first sheet.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      if (!params.range) {
        // When no range is provided, first fetch the first worksheet name (to avoid hardcoding "Sheet1")
        // We'll read its default range after in transformResponse
        return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets?$select=name&$orderby=position&$top=1`
      }

      const rangeInput = params.range.trim()

      // If the input contains no '!', treat it as a sheet name only and fetch usedRange
      if (!rangeInput.includes('!')) {
        const sheetOnly = encodeURIComponent(rangeInput)
        return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('${sheetOnly}')/usedRange(valuesOnly=true)`
      }

      const match = rangeInput.match(/^([^!]+)!(.+)$/)

      if (!match) {
        throw new Error(
          `Invalid range format: "${params.range}". Use "Sheet1!A1:B2" or just "Sheet1" to read the whole sheet`
        )
      }

      const sheetName = encodeURIComponent(match[1])
      const address = encodeURIComponent(match[2])

      return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('${sheetName}')/range(address='${address}')`
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

  transformResponse: async (response: Response, params?: MicrosoftExcelToolParams) => {
    // If we came from the worksheets listing (no range provided), resolve first sheet name then fetch range
    if (response.url.includes('/workbook/worksheets?')) {
      const listData = await response.json()
      const firstSheetName: string | undefined = listData?.value?.[0]?.name

      if (!firstSheetName) {
        throw new Error('No worksheets found in the Excel workbook')
      }

      const spreadsheetIdFromUrl = response.url.split('/drive/items/')[1]?.split('/')[0] || ''
      const accessToken = params?.accessToken
      if (!accessToken) {
        throw new Error('Access token is required to read Excel range')
      }

      // Use usedRange(valuesOnly=true) to fetch only populated cells, avoiding thousands of empty rows
      const rangeUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(
        spreadsheetIdFromUrl
      )}/workbook/worksheets('${encodeURIComponent(firstSheetName)}')/usedRange(valuesOnly=true)`

      const rangeResp = await fetch(rangeUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!rangeResp.ok) {
        // Normalize Microsoft Graph sheet/range errors to a friendly message
        throw new Error(
          'Invalid range provided or worksheet not found. Provide a range like "Sheet1!A1:B2" or just the sheet name to read the whole sheet'
        )
      }

      const data = await rangeResp.json()

      // usedRange returns an address (A1 notation) and values matrix
      const address: string = data.address || data.addressLocal || `${firstSheetName}!A1`
      const rawValues: ExcelCellValue[][] = data.values || []

      const values = trimTrailingEmptyRowsAndColumns(rawValues)

      // Fetch the browser-accessible web URL
      const webUrl = await getSpreadsheetWebUrl(spreadsheetIdFromUrl, accessToken)

      const metadata = {
        spreadsheetId: spreadsheetIdFromUrl,
        properties: {},
        spreadsheetUrl: webUrl,
      }

      const result: MicrosoftExcelReadResponse = {
        success: true,
        output: {
          data: {
            range: address,
            values,
          },
          metadata: {
            spreadsheetId: metadata.spreadsheetId,
            spreadsheetUrl: metadata.spreadsheetUrl,
          },
        },
      }

      return result
    }

    // Normal path: caller supplied a range; just return the parsed result
    const data = await response.json()

    const urlParts = response.url.split('/drive/items/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    // Fetch the browser-accessible web URL
    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

    const metadata = {
      spreadsheetId,
      properties: {},
      spreadsheetUrl: webUrl,
    }

    const address: string = data.address || data.addressLocal || data.range || ''
    const rawValues: ExcelCellValue[][] = data.values || []
    const values = trimTrailingEmptyRowsAndColumns(rawValues)

    const result: MicrosoftExcelReadResponse = {
      success: true,
      output: {
        data: {
          range: address,
          values,
        },
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }

    return result
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Range data from the spreadsheet',
      properties: {
        range: { type: 'string', description: 'The range that was read' },
        values: { type: 'array', description: 'Array of rows containing cell values' },
      },
    },
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
