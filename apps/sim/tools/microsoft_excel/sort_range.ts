import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftExcelSortRangeParams,
  MicrosoftExcelSortRangeResponse,
} from '@/tools/microsoft_excel/types'
import {
  buildWorksheetRangeUrl,
  getItemBasePath,
  getSpreadsheetWebUrl,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Sorts a worksheet range or a table by a single column.
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
  description: 'Sort a range or table by a column in a Microsoft Excel worksheet',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

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
      description: 'The ID of the spreadsheet/workbook (e.g., "01ABC123DEF456")',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'The zero-based column index within the range or table to sort on (0 = first column).',
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
        return `${basePath}/workbook/tables('${encodeURIComponent(tableName)}')/sort/apply`
      }

      return `${buildWorksheetRangeUrl(basePath, params.range, params.sheetName)}/sort/apply`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      const key =
        typeof params.sortColumn === 'number' ? params.sortColumn : Number(params.sortColumn)
      if (!Number.isInteger(key) || key < 0) {
        throw new Error('sortColumn must be a non-negative integer column index')
      }

      const body: Record<string, unknown> = {
        fields: [
          {
            key,
            ascending: params.sortAscending ?? true,
            sortOn: 'Value',
          },
        ],
        matchCase: params.matchCase ?? false,
      }

      if (!params.tableName?.trim()) {
        body.hasHeaders = params.hasHeaders ?? false
        body.orientation = 'Rows'
      }

      return body
    },
  },

  transformResponse: async (_response: Response, params?: MicrosoftExcelSortRangeParams) => {
    const spreadsheetId = params?.spreadsheetId?.trim() || ''
    const driveId = params?.driveId

    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken, driveId)

    const target = params?.tableName?.trim() || params?.range || ''

    return {
      success: true,
      output: {
        sorted: true,
        target,
        sortColumn: params?.sortColumn ?? 0,
        ascending: params?.sortAscending ?? true,
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
    sortColumn: { type: 'number', description: 'The zero-based column index that was sorted on' },
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
