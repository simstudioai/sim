import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
} from '@/tools/microsoft_excel/shared'
import type {
  MicrosoftExcelSortRangeParams,
  MicrosoftExcelSortRangeResponse,
} from '@/tools/microsoft_excel/types'
import {
  buildWorksheetRangeUrl,
  escapeODataString,
  getItemBasePath,
  getSpreadsheetWebUrl,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

function resolveSortFields(
  params: Pick<MicrosoftExcelSortRangeParams, 'sortFields' | 'sortColumn' | 'sortAscending'>
): Array<Record<string, unknown> & { key: number; ascending: boolean }> {
  let fields: unknown = params.sortFields
  if (typeof fields === 'string') fields = fields.trim() ? JSON.parse(fields) : undefined
  if (fields === undefined || fields === null) {
    const key = params.sortColumn
    if (key === undefined || !Number.isSafeInteger(key) || key < 0)
      throw new Error('Provide a non-negative sortColumn or sortFields')
    return [{ key, ascending: params.sortAscending ?? true, sortOn: 'Value' }]
  }
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > 64)
    throw new Error('sortFields must contain 1 to 64 conditions')
  return fields.map((field) => {
    if (
      !isRecordLike(field) ||
      typeof field.key !== 'number' ||
      !Number.isSafeInteger(field.key) ||
      field.key < 0
    )
      throw new Error('Each sort field must have a non-negative integer key')
    if (
      field.ascending !== undefined &&
      field.ascending !== null &&
      typeof field.ascending !== 'boolean'
    )
      throw new Error('A sort field ascending value must be boolean')
    return {
      ...field,
      key: field.key,
      ascending: typeof field.ascending === 'boolean' ? field.ascending : true,
    }
  })
}

/**
 * Sorts a worksheet range or a table by one or more fields.
 * Uses Microsoft Graph:
 *   - Range: POST /workbook/worksheets/{name}/range(address='...')/sort/apply
 *   - Table: POST /workbook/tables('{name}')/sort/apply
 */
export const sortRangeTool: ToolConfig<
  MicrosoftExcelSortRangeParams,
  MicrosoftExcelSortRangeResponse
> = {
  id: 'microsoft_excel_sort_range',
  name: 'Sort Microsoft Excel Range',
  description: 'Sort a range or table by one or more fields in a Microsoft Excel worksheet',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'microsoft-excel',
  },

  params: {
    sortFields: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        required: ['key'],
        additionalProperties: false,
        properties: {
          key: { type: 'integer', minimum: 0 },
          ascending: { type: 'boolean' },
          sortOn: {
            anyOf: [
              { const: 'Value' },
              { const: 'CellColor' },
              { const: 'FontColor' },
              { const: 'Icon' },
            ],
          },
          color: { type: 'string' },
          dataOption: { anyOf: [{ const: 'Normal' }, { const: 'TextAsNumber' }] },
          icon: {
            type: 'object',
            required: ['set', 'index'],
            additionalProperties: false,
            properties: { set: { type: 'string' }, index: { type: 'integer', minimum: 0 } },
          },
        },
      },
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort conditions [{key, ascending, sortOn, color, dataOption, icon}]. Overrides sortColumn/sortAscending; ascending defaults to true for each condition; key is a zero-based offset, sortOn is Value, CellColor, FontColor, or Icon; dataOption is Normal or TextAsNumber; icon contains set and index.',
    },
    sortMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Chinese character ordering: PinYin or StrokeCount.',
    },
    orientation: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows (default) or Columns. Applies only to range sorts.',
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
      description: 'The ID of the spreadsheet/workbook (e.g., "01ABC123DEF456")',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the table to sort. When provided, the table is sorted and range/sheetName are ignored.',
    },
    sheetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the worksheet (e.g., "Sheet1"). Used for range sorts when the range does not include a sheet name.',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The cell range to sort (e.g., "A1:D10" or "Sheet1!A1:D10"). Required when no table name is provided.',
    },
    sortColumn: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Zero-based sort key: column offset for Rows orientation, row offset for Columns orientation.',
    },
    sortAscending: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to sort in ascending order. Defaults to true.',
    },
    hasHeaders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the range has a header row that should be excluded from sorting. Only applies to range sorts. Defaults to false.',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether casing affects string ordering. Defaults to false.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      const basePath = getItemBasePath(spreadsheetId, params.driveId)

      const tableName = params.tableName?.trim()
      if (tableName) {
        return `${basePath}/workbook/tables('${encodeURIComponent(escapeODataString(tableName))}')/sort/apply`
      }

      return `${buildWorksheetRangeUrl(basePath, params.range, params.sheetName)}/sort/apply`
    },
    method: 'POST',
    headers: excelHeaders,
    body: (params) => {
      const fields = resolveSortFields(params)
      const sortMethod = params.sortMethod?.trim()
      if (sortMethod && !['PinYin', 'StrokeCount'].includes(sortMethod))
        throw new Error('Invalid sort method')

      const body: Record<string, unknown> = {
        fields,
        matchCase: params.matchCase ?? false,
        ...(sortMethod ? { method: sortMethod } : {}),
      }

      if (!params.tableName?.trim()) {
        const orientation = params.orientation?.trim() || 'Rows'
        if (!['Rows', 'Columns'].includes(orientation)) throw new Error('Invalid sort orientation')
        body.hasHeaders = params.hasHeaders ?? false
        body.orientation = orientation
      }

      return body
    },
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftExcelSortRangeParams,
    context?: ToolResponseContext
  ) => {
    await assertExcelSuccess(response)
    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId, context?.signal)

    const target = params?.tableName?.trim() || params?.range || ''
    const first = resolveSortFields(params ?? {})[0]

    return {
      success: true,
      output: {
        sorted: true,
        target,
        sortColumn: first.key,
        ascending: first.ascending,
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    sorted: { type: 'boolean', description: 'Whether the sort was applied' },
    target: { type: 'string', description: 'The range or table name that was sorted' },
    sortColumn: { type: 'number', description: 'The zero-based key of the first sort condition' },
    ascending: { type: 'boolean', description: 'Whether the sort was ascending' },
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
