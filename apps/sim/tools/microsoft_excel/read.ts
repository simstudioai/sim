import type {
  ExcelCellValue,
  MicrosoftExcelReadResponse,
  MicrosoftExcelToolParams,
  MicrosoftExcelV2ReadResponse,
  MicrosoftExcelV2ToolParams,
} from '@/tools/microsoft_excel/types'
import {
  getItemBasePath,
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
      visibility: 'user-or-llm',
      description: 'The ID of the spreadsheet/workbook to read from (e.g., "01ABC123DEF456")',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses personal OneDrive.',
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

      const basePath = getItemBasePath(spreadsheetId, params.driveId)

      if (!params.range) {
        return `${basePath}/workbook/worksheets?$select=name&$orderby=position&$top=1`
      }

      const rangeInput = params.range.trim()

      if (!rangeInput.includes('!')) {
        const sheetOnly = encodeURIComponent(rangeInput)
        return `${basePath}/workbook/worksheets('${sheetOnly}')/usedRange(valuesOnly=true)`
      }

      const match = rangeInput.match(/^([^!]+)!(.+)$/)

      if (!match) {
        throw new Error(
          `Invalid range format: "${params.range}". Use "Sheet1!A1:B2" or just "Sheet1" to read the whole sheet`
        )
      }

      const sheetName = encodeURIComponent(match[1])
      const address = encodeURIComponent(match[2])

      return `${basePath}/workbook/worksheets('${sheetName}')/range(address='${address}')`
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
    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    // If we came from the worksheets listing (no range provided), resolve first sheet name then fetch range
    if (response.url.includes('/workbook/worksheets?')) {
      const listData = await response.json()
      const firstSheetName: string | undefined = listData?.value?.[0]?.name

      if (!firstSheetName) {
        throw new Error('No worksheets found in the Excel workbook')
      }

      const accessToken = params?.accessToken
      if (!accessToken) {
        throw new Error('Access token is required to read Excel range')
      }

      const basePath = getItemBasePath(spreadsheetId, driveId)
      const rangeUrl = `${basePath}/workbook/worksheets('${encodeURIComponent(firstSheetName)}')/usedRange(valuesOnly=true)`

      const rangeResp = await fetch(rangeUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!rangeResp.ok) {
        throw new Error(
          'Invalid range provided or worksheet not found. Provide a range like "Sheet1!A1:B2" or just the sheet name to read the whole sheet'
        )
      }

      const data = await rangeResp.json()

      const address: string = data.address || data.addressLocal || `${firstSheetName}!A1`
      const rawValues: ExcelCellValue[][] = data.values || []

      const values = trimTrailingEmptyRowsAndColumns(rawValues)

      const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId)

      const result: MicrosoftExcelReadResponse = {
        success: true,
        output: {
          data: {
            range: address,
            values,
          },
          metadata: {
            spreadsheetId,
            spreadsheetUrl: webUrl,
          },
        },
      }

      return result
    }

    // Normal path: caller supplied a range; just return the parsed result
    const data = await response.json()

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId)

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
          spreadsheetId,
          spreadsheetUrl: webUrl,
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
      visibility: 'user-or-llm',
      description: 'The ID of the spreadsheet/workbook to read from (e.g., "01ABC123DEF456")',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses personal OneDrive.',
    },
    sheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the sheet/tab to read from (e.g., "Sheet1", "Sales Data")',
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

      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      const encodedSheetName = encodeURIComponent(sheetName)

      if (!params.cellRange) {
        return `${basePath}/workbook/worksheets('${encodedSheetName}')/usedRange(valuesOnly=true)`
      }

      const cellRange = params.cellRange.trim()
      const encodedAddress = encodeURIComponent(cellRange)

      return `${basePath}/workbook/worksheets('${encodedSheetName}')/range(address='${encodedAddress}')`
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

    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId)

    const address: string = data.address || data.addressLocal || ''
    const rawValues: ExcelCellValue[][] = data.values || []
    const values = trimTrailingEmptyRowsAndColumns(rawValues)

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
