import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftExcelCreateTableParams,
  MicrosoftExcelCreateTableResponse,
} from '@/tools/microsoft_excel/types'
import { getItemBasePath, getSpreadsheetWebUrl } from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Creates a new table over a range of cells.
 * Uses Microsoft Graph: POST /workbook/tables/add with { address, hasHeaders }.
 */
export const createTableTool: ToolConfig<
  MicrosoftExcelCreateTableParams,
  MicrosoftExcelCreateTableResponse
> = {
  id: 'microsoft_excel_create_table',
  name: 'Create Microsoft Excel Table',
  description: 'Create a new table over a range of cells in a Microsoft Excel workbook',
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
    address: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The range address for the table data source (e.g., "Sheet1!A1:D5"). If no sheet name is included, the active sheet is used.',
    },
    hasHeaders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the first row of the range contains column headers. Defaults to true.',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      return `${basePath}/workbook/tables/add`
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
      const address = params.address?.trim()
      if (!address) {
        throw new Error('A range address is required (e.g., "Sheet1!A1:D5")')
      }
      return {
        address,
        hasHeaders: params.hasHeaders ?? true,
      }
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftExcelCreateTableParams) => {
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
        table: {
          id: data.id ?? '',
          name: data.name ?? '',
          showHeaders: data.showHeaders ?? true,
          showTotals: data.showTotals ?? false,
          style: data.style ?? null,
        },
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    table: {
      type: 'object',
      description: 'Details of the newly created table',
      properties: {
        id: { type: 'string', description: 'The unique ID of the table' },
        name: { type: 'string', description: 'The name of the table' },
        showHeaders: { type: 'boolean', description: 'Whether the header row is shown' },
        showTotals: { type: 'boolean', description: 'Whether the totals row is shown' },
        style: { type: 'string', description: 'The table style name' },
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
