import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_RANGE_OUTPUTS,
  EXCEL_ROW_INPUT,
  EXCEL_VALUES_INPUT,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  mapExcelRange,
  normalizeExcelValues,
} from '@/tools/microsoft_excel/shared'
import type {
  MicrosoftExcelToolParams,
  MicrosoftExcelV2ToolParams,
  MicrosoftExcelV2WriteResponse,
  MicrosoftExcelWriteResponse,
} from '@/tools/microsoft_excel/types'
import {
  buildWorksheetRangeUrl,
  getItemBasePath,
  getSpreadsheetWebUrl,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

/**
 * Range writes (PATCH /workbook/.../range) are semantically idempotent —
 * the same payload produces the same result — so we permit retries on
 * transient 429/5xx even though PATCH is not in the default idempotent set.
 */
const EXCEL_RETRY_CONFIG = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  retryIdempotentOnly: false,
} as const

export const writeTool: ToolConfig<MicrosoftExcelToolParams, MicrosoftExcelWriteResponse> = {
  id: 'microsoft_excel_write',
  name: 'Write to Microsoft Excel',
  description: 'Write data to a Microsoft Excel spreadsheet',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-excel',
  },

  params: {
    formulas: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description: 'A1-style formulas as a two-dimensional array. Null leaves a cell unchanged.',
    },
    formulasLocal: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'A1-style formulas in the user locale as a two-dimensional array. Null leaves a cell unchanged.',
    },
    formulasR1C1: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description: 'R1C1-style formulas as a two-dimensional array. Null leaves a cell unchanged.',
    },
    numberFormat: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'Excel number format codes as a two-dimensional array. Null leaves a cell unchanged.',
    },
    columnHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hide all columns in the target range.',
    },
    rowHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hide all rows in the target range.',
    },
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
      description: 'The ID of the spreadsheet/workbook to write to (e.g., "01ABC123DEF456")',
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
      description: 'The range of cells to write to (e.g., "Sheet1!A1:B2")',
    },
    values: {
      type: 'array',
      items: EXCEL_VALUES_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'The data to write as a 2D array (used exactly as provided) or array of objects. For object rows, their keys become a header row. Use a 2D array to write data without added headers.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      return buildWorksheetRangeUrl(getItemBasePath(spreadsheetId, params.driveId), params.range)
    },
    method: 'PATCH',
    headers: excelHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.values !== undefined && params.values !== null)
        body.values = normalizeExcelValues(params.values, { includeHeaders: true })
      for (const key of ['formulas', 'formulasLocal', 'formulasR1C1', 'numberFormat'] as const) {
        if (params[key] !== undefined && params[key] !== null)
          body[key] = normalizeExcelValues(params[key], { matrixOnly: true })
      }
      if (params.columnHidden !== undefined) body.columnHidden = params.columnHidden
      if (params.rowHidden !== undefined) body.rowHidden = params.rowHidden
      if (Object.keys(body).length === 0)
        throw new Error('Provide values, formulas, number formatting, or row/column visibility')
      return body
    },
    retry: EXCEL_RETRY_CONFIG,
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftExcelToolParams,
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

    return {
      success: true,
      output: {
        ...mapExcelRange(data),
        updatedRange: data.address ?? '',
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
    ...EXCEL_RANGE_OUTPUTS,
    updatedRange: { type: 'string', description: 'The range that was updated' },
    updatedRows: { type: 'number', description: 'Number of rows that were updated' },
    updatedColumns: { type: 'number', description: 'Number of columns that were updated' },
    updatedCells: { type: 'number', description: 'Number of cells that were updated' },
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

export const writeV2Tool: ToolConfig<MicrosoftExcelV2ToolParams, MicrosoftExcelV2WriteResponse> = {
  id: 'microsoft_excel_write_v2',
  name: 'Write to Microsoft Excel V2',
  description: 'Write data to a specific sheet in a Microsoft Excel spreadsheet',
  version: '2.0.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-excel',
  },

  params: {
    formulas: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description: 'A1-style formulas as a two-dimensional array. Null leaves a cell unchanged.',
    },
    formulasLocal: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'A1-style formulas in the user locale as a two-dimensional array. Null leaves a cell unchanged.',
    },
    formulasR1C1: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description: 'R1C1-style formulas as a two-dimensional array. Null leaves a cell unchanged.',
    },
    numberFormat: {
      type: 'array',
      items: EXCEL_ROW_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'Excel number format codes as a two-dimensional array. Null leaves a cell unchanged.',
    },
    columnHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hide all columns in the target range.',
    },
    rowHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hide all rows in the target range.',
    },
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
      description: 'The ID of the spreadsheet/workbook to write to (e.g., "01ABC123DEF456")',
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
      description: 'The name of the sheet/tab to write to (e.g., "Sheet1", "Sales Data")',
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
      items: EXCEL_VALUES_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'The data to write as a 2D array (used exactly as provided) or array of objects. For object rows, their keys become a header row. Use a 2D array to write data without added headers.',
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

      return buildWorksheetRangeUrl(
        getItemBasePath(spreadsheetId, params.driveId),
        params.cellRange?.trim() || 'A1',
        sheetName
      )
    },
    method: 'PATCH',
    headers: excelHeaders,
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.values !== undefined && params.values !== null)
        body.values = normalizeExcelValues(params.values, { includeHeaders: true })
      for (const key of ['formulas', 'formulasLocal', 'formulasR1C1', 'numberFormat'] as const) {
        if (params[key] !== undefined && params[key] !== null)
          body[key] = normalizeExcelValues(params[key], { matrixOnly: true })
      }
      if (params.columnHidden !== undefined) body.columnHidden = params.columnHidden
      if (params.rowHidden !== undefined) body.rowHidden = params.rowHidden
      if (Object.keys(body).length === 0)
        throw new Error('Provide values, formulas, number formatting, or row/column visibility')
      return body
    },
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

    return {
      success: true,
      output: {
        ...mapExcelRange(data),
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
    ...EXCEL_RANGE_OUTPUTS,
    updatedRange: {
      type: 'string',
      nullable: true,
      description: 'Range of cells that were updated',
    },
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
