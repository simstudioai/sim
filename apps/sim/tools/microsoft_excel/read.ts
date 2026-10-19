import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_RANGE_OUTPUTS,
  EXCEL_VALUES_OUTPUT,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  mapExcelRange,
} from '@/tools/microsoft_excel/shared'
import type {
  ExcelCellValue,
  MicrosoftExcelReadResponse,
  MicrosoftExcelToolParams,
  MicrosoftExcelV2ReadResponse,
  MicrosoftExcelV2ToolParams,
} from '@/tools/microsoft_excel/types'
import {
  buildWorksheetRangeUrl,
  escapeODataString,
  getItemBasePath,
  getSpreadsheetWebUrl,
  parseGraphErrorMessage,
  trimTrailingEmptyRowsAndColumns,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

const EXCEL_RETRY_CONFIG = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  retryIdempotentOnly: true,
} as const

export const readTool: ToolConfig<MicrosoftExcelToolParams, MicrosoftExcelReadResponse> = {
  id: 'microsoft_excel_read',
  name: 'Read from Microsoft Excel',
  description: 'Read data from a Microsoft Excel spreadsheet',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-excel',
  },

  params: {
    sessionId: EXCEL_WORKBOOK_PARAMS.sessionId,
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
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses the signed-in user’s default OneDrive. Excel workbook APIs require a business account.',
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
        const sheetOnly = encodeURIComponent(escapeODataString(rangeInput))
        return `${basePath}/workbook/worksheets('${sheetOnly}')/usedRange(valuesOnly=true)`
      }

      return buildWorksheetRangeUrl(basePath, rangeInput)
    },
    method: 'GET',
    headers: excelHeaders,
    retry: EXCEL_RETRY_CONFIG,
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftExcelToolParams,
    context?: ToolResponseContext
  ) => {
    await assertExcelSuccess(response)
    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    if (!params?.range?.trim()) {
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
      const rangeUrl = `${basePath}/workbook/worksheets('${encodeURIComponent(escapeODataString(firstSheetName))}')/usedRange(valuesOnly=true)`

      const rangeResp = await fetch(rangeUrl, {
        headers: excelHeaders({ accessToken, sessionId: params?.sessionId }),
        signal: context?.signal,
      })

      if (!rangeResp.ok) {
        const errorText = await readResponseTextWithLimit(rangeResp, {
          maxBytes: 65536,
          label: 'Excel error',
          signal: context?.signal,
        })
        const detail = parseGraphErrorMessage(rangeResp.status, rangeResp.statusText, errorText)
        throw new Error(
          `Failed to read worksheet "${firstSheetName}": ${detail}. Provide a range like "Sheet1!A1:B2" or just the sheet name to read the whole sheet.`
        )
      }

      const data = JSON.parse(
        await readResponseTextWithLimit(rangeResp, {
          maxBytes: 10 * 1024 * 1024,
          label: 'Excel range',
          signal: context?.signal,
        })
      )

      const address: string = data.address || data.addressLocal || `${firstSheetName}!A1`
      const rawValues: ExcelCellValue[][] = data.values || []

      const values = trimTrailingEmptyRowsAndColumns(rawValues)

      const webUrl = await getSpreadsheetWebUrl(
        spreadsheetId,
        accessToken,
        driveId,
        context?.signal
      )

      const result: MicrosoftExcelReadResponse = {
        success: true,
        output: {
          data: {
            ...mapExcelRange(data),
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

    const data = await response.json()

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId, context?.signal)

    const address: string = data.address || data.addressLocal || data.range || ''
    const rawValues: ExcelCellValue[][] = data.values || []
    const values = trimTrailingEmptyRowsAndColumns(rawValues)

    const result: MicrosoftExcelReadResponse = {
      success: true,
      output: {
        data: {
          ...mapExcelRange(data),
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
        ...EXCEL_RANGE_OUTPUTS,
        range: { type: 'string', description: 'The range that was read' },
        values: { ...EXCEL_VALUES_OUTPUT },
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
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-excel',
  },

  params: {
    sessionId: EXCEL_WORKBOOK_PARAMS.sessionId,
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
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses the signed-in user’s default OneDrive. Excel workbook APIs require a business account.',
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
      const encodedSheetName = encodeURIComponent(escapeODataString(sheetName))

      if (!params.cellRange) {
        return `${basePath}/workbook/worksheets('${encodedSheetName}')/usedRange(valuesOnly=true)`
      }

      return buildWorksheetRangeUrl(basePath, params.cellRange, sheetName)
    },
    method: 'GET',
    headers: excelHeaders,
    retry: EXCEL_RETRY_CONFIG,
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftExcelV2ToolParams,
    context?: ToolResponseContext
  ) => {
    await assertExcelSuccess(response)
    const data = await response.json()

    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId, context?.signal)

    const address: string = data.address || data.addressLocal || ''
    const rawValues: ExcelCellValue[][] = data.values || []
    const values = trimTrailingEmptyRowsAndColumns(rawValues)

    const sheetName = params?.sheetName || address.split('!')[0] || ''

    return {
      success: true,
      output: {
        ...mapExcelRange(data),
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
    ...EXCEL_RANGE_OUTPUTS,
    sheetName: { type: 'string', description: 'Name of the sheet that was read' },
    range: { type: 'string', description: 'The range that was read' },
    values: { ...EXCEL_VALUES_OUTPUT },
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
