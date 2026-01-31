import type {
  MicrosoftExcelWorksheetAddResponse,
  MicrosoftExcelWorksheetToolParams,
} from '@/tools/microsoft_excel/types'
import { getSpreadsheetWebUrl } from '@/tools/microsoft_excel/utils'
import type { ToolConfig } from '@/tools/types'

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
      description: 'The ID of the Excel workbook to add the worksheet to (e.g., "01ABC123DEF456")',
    },
    worksheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The name of the new worksheet (e.g., "Sales Q1", "Data"). Must be unique within the workbook and cannot exceed 31 characters',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }
      return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets/add`
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
      const worksheetName = params.worksheetName?.trim()

      if (!worksheetName) {
        throw new Error('Worksheet name is required')
      }

      // Validate worksheet name length (Excel limitation)
      if (worksheetName.length > 31) {
        throw new Error('Worksheet name cannot exceed 31 characters. Please provide a shorter name')
      }

      // Validate worksheet name doesn't contain invalid characters
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

  transformResponse: async (response: Response, params?: MicrosoftExcelWorksheetToolParams) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData?.error?.message || `Failed to create worksheet: ${response.statusText}`

      // Handle specific error cases
      if (response.status === 409) {
        throw new Error('A worksheet with this name already exists. Please choose a different name')
      }

      throw new Error(errorMessage)
    }

    const data = await response.json()

    const urlParts = response.url.split('/drive/items/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    // Fetch the browser-accessible web URL
    const accessToken = params?.accessToken
    if (!accessToken) {
      throw new Error('Access token is required')
    }
    const webUrl = await getSpreadsheetWebUrl(spreadsheetId, accessToken)

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
