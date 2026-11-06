import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_VALUES_INPUT,
  EXCEL_VALUES_OUTPUT,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
  excelInteger,
  normalizeExcelValues,
} from '@/tools/microsoft_excel/shared'
import type {
  MicrosoftExcelTableAddResponse,
  MicrosoftExcelTableToolParams,
} from '@/tools/microsoft_excel/types'
import {
  escapeODataString,
  getItemBasePath,
  getSpreadsheetWebUrl,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

export const tableAddTool: ToolConfig<
  MicrosoftExcelTableToolParams,
  MicrosoftExcelTableAddResponse
> = {
  id: 'microsoft_excel_table_add',
  name: 'Add to Microsoft Excel Table',
  description: 'Add new rows to a Microsoft Excel table',
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
      description:
        'The ID of the spreadsheet/workbook containing the table (e.g., "01ABC123DEF456")',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses the signed-in user’s default OneDrive. Excel workbook APIs require a business account.',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the table to add rows to (e.g., "Table1", "SalesTable")',
    },
    index: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zero-based insertion index. Omit to append at the end.',
    },
    values: {
      type: 'array',
      items: EXCEL_VALUES_INPUT,
      minItems: 1,
      maxItems: 10000,
      required: false,
      visibility: 'user-or-llm',
      description:
        'Data rows in table column order, without headers (e.g., [["Value", 30]]). Object rows are also accepted in key order for compatibility. Omit to add a blank row.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      const tableName = params.tableName?.trim()
      if (!tableName) {
        throw new Error('Table name is required')
      }
      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      return `${basePath}/workbook/tables('${encodeURIComponent(escapeODataString(tableName))}')/rows/add`
    },
    method: 'POST',
    headers: excelHeaders,
    body: (params) => ({
      ...(params.values !== undefined ? { values: normalizeExcelValues(params.values) } : {}),
      ...(params.index !== undefined ? { index: excelInteger(params.index, 'index') } : {}),
    }),
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftExcelTableToolParams,
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
    values: { ...EXCEL_VALUES_OUTPUT },
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
