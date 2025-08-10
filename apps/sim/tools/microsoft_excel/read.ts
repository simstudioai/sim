import type {
  MicrosoftExcelReadResponse,
  MicrosoftExcelToolParams,
} from '@/tools/microsoft_excel/types'
import type { ToolConfig } from '@/tools/types'

export const readTool: ToolConfig<MicrosoftExcelToolParams, MicrosoftExcelReadResponse> = {
  id: 'microsoft_excel_read',
  name: 'Read from Microsoft Excel',
  description: 'Read data from a Microsoft Excel spreadsheet',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'microsoft-excel',
    additionalScopes: [],
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
      visibility: 'user-only',
      description: 'The ID of the spreadsheet to read from',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The range of cells to read from',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      if (!params.range) {
        return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('Sheet1')/range(address='A1:Z1000')`
      }

      const rangeInput = params.range.trim()
      const match = rangeInput.match(/^([^!]+)!(.+)$/)

      if (!match) {
        throw new Error(`Invalid range format: "${params.range}". Use the format "Sheet1!A1:B2"`)
      }

      const sheetName = encodeURIComponent(match[1])
      const address = encodeURIComponent(match[2])

      return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets('${sheetName}')/range(address='${address}')`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const urlParts = response.url.split('/drive/items/')
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    const metadata = {
      spreadsheetId,
      properties: {},
      spreadsheetUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}`,
    }

    const result: MicrosoftExcelReadResponse = {
      success: true,
      output: {
        data: {
          range: data.range || '',
          values: data.values || [],
        },
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Excel spreadsheet data and metadata',
      properties: {
        data: {
          type: 'object',
          description: 'Range data from the spreadsheet',
          properties: {
            range: { type: 'string', description: 'The range that was read' },
            values: { type: 'array', description: 'Array of rows containing cell values' },
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
    },
  },
}
