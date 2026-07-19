import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftExcelClearRangeParams,
  MicrosoftExcelClearRangeResponse,
} from '@/tools/microsoft_excel/types'
import {
  buildWorksheetRangeUrl,
  getItemBasePath,
  getSpreadsheetWebUrl,
} from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Clears the contents and/or formatting of a worksheet range.
 * Uses Microsoft Graph: POST /workbook/worksheets/{name}/range(address='...')/clear
 */
export const clearRangeTool: ToolConfig<
  MicrosoftExcelClearRangeParams,
  MicrosoftExcelClearRangeResponse
> = {
  id: 'microsoft_excel_clear_range',
  name: 'Clear Microsoft Excel Range',
  description: 'Clear the values and/or formatting of a range in a Microsoft Excel worksheet',
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
    sheetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the worksheet (e.g., "Sheet1"). If omitted, the range must use the combined "Sheet1!A1:B2" format.',
    },
    range: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The cell range to clear (e.g., "A1:D10" or "Sheet1!A1:D10")',
    },
    applyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'What to clear: "All", "Formats", or "Contents". Defaults to "All".',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      return `${buildWorksheetRangeUrl(basePath, params.range, params.sheetName)}/clear`
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
    body: (params) => ({
      applyTo: params.applyTo || 'All',
    }),
  },

  transformResponse: async (_response: Response, params?: MicrosoftExcelClearRangeParams) => {
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
        cleared: true,
        range: params?.range ?? '',
        applyTo: params?.applyTo || 'All',
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    cleared: { type: 'boolean', description: 'Whether the range was cleared' },
    range: { type: 'string', description: 'The range that was cleared' },
    applyTo: { type: 'string', description: 'What was cleared (All, Formats, or Contents)' },
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
