import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  assertExcelSuccess,
  EXCEL_WORKBOOK_PARAMS,
  excelHeaders,
} from '@/tools/microsoft_excel/shared'
import type {
  MicrosoftExcelWorksheetAddResponse,
  MicrosoftExcelWorksheetToolParams,
} from '@/tools/microsoft_excel/types'
import { getItemBasePath, getSpreadsheetWebUrl } from '@/tools/microsoft_excel/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

/**
 * Tool for adding a new worksheet to a Microsoft Excel workbook
 * Uses Microsoft Graph API endpoint: POST /me/drive/items/{id}/workbook/worksheets/add
 */
export const worksheetAddTool: ToolConfig<
  MicrosoftExcelWorksheetToolParams,
  MicrosoftExcelWorksheetAddResponse
> = {
  id: 'microsoft_excel_worksheet_add',
  name: 'Add Worksheet to Microsoft Excel',
  description: 'Create a new worksheet (sheet) in a Microsoft Excel workbook',
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
      description: 'The ID of the Excel workbook to add the worksheet to (e.g., "01ABC123DEF456")',
    },
    driveId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The ID of the drive containing the spreadsheet. Required for SharePoint files. If omitted, uses the signed-in user’s default OneDrive. Excel workbook APIs require a business account.',
    },
    worksheetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of the new worksheet (e.g., "Sales Q1", "Data"). Omit for an automatic name. Supplied names must be unique within the workbook and cannot exceed 31 characters',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      const basePath = getItemBasePath(spreadsheetId, params.driveId)
      return `${basePath}/workbook/worksheets/add`
    },
    method: 'POST',
    headers: excelHeaders,
    body: (params) => {
      const worksheetName = params.worksheetName?.trim()

      if (!worksheetName) return {}

      if (worksheetName.length > 31) {
        throw new Error('Worksheet name cannot exceed 31 characters. Please provide a shorter name')
      }

      const invalidChars = ['\\', '/', '?', '*', '[', ']', ':']
      for (const char of invalidChars) {
        if (worksheetName.includes(char)) {
          throw new Error(`Worksheet name cannot contain the following characters: \\ / ? * [ ] :`)
        }
      }

      return {
        name: worksheetName,
      }
    },
  },

  transformResponse: async (
    response: Response,
    params?: MicrosoftExcelWorksheetToolParams,
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

    const result: MicrosoftExcelWorksheetAddResponse = {
      success: true,
      output: {
        worksheet: {
          id: data.id || '',
          name: data.name || '',
          position: data.position ?? 0,
          visibility: data.visibility || 'Visible',
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
    worksheet: {
      type: 'object',
      description: 'Details of the newly created worksheet',
      properties: {
        id: { type: 'string', description: 'The unique ID of the worksheet' },
        name: { type: 'string', description: 'The name of the worksheet' },
        position: { type: 'number', description: 'The zero-based position of the worksheet' },
        visibility: {
          type: 'string',
          description: 'The visibility state of the worksheet (Visible/Hidden/VeryHidden)',
        },
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
