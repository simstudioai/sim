import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftExcelDeleteWorksheetParams,
  MicrosoftExcelDeleteWorksheetResponse,
} from '@/tools/microsoft_excel/types'
import { getItemBasePath, getSpreadsheetWebUrl } from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Deletes a worksheet from a workbook.
 * Uses Microsoft Graph: DELETE /workbook/worksheets/{name}
 */
export const deleteWorksheetTool: ToolConfig<
  MicrosoftExcelDeleteWorksheetParams,
  MicrosoftExcelDeleteWorksheetResponse
> = {
  id: 'microsoft_excel_delete_worksheet',
  name: 'Delete Microsoft Excel Worksheet',
  description: 'Delete a worksheet (sheet) from a Microsoft Excel workbook',
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
    worksheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the worksheet to delete (e.g., "Sheet1", "Old Data")',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      const worksheetName = params.worksheetName?.trim()
      if (!worksheetName) {
        throw new Error('Worksheet name is required')
      }
      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      return `${basePath}/workbook/worksheets('${encodeURIComponent(worksheetName)}')`
    },
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (_response: Response, params?: MicrosoftExcelDeleteWorksheetParams) => {
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
        deleted: true,
        worksheetName: params?.worksheetName?.trim() ?? '',
        metadata: {
          spreadsheetId,
          spreadsheetUrl: webUrl,
        },
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the worksheet was deleted' },
    worksheetName: { type: 'string', description: 'The name of the deleted worksheet' },
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
