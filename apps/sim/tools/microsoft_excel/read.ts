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
        // When no range is provided, first fetch the first worksheet name (to avoid hardcoding "Sheet1")
        // We'll read its default range after in transformResponse
        return `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetId}/workbook/worksheets?$select=name&$orderby=position&$top=1`
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

  transformResponse: async (response: Response, params?: MicrosoftExcelToolParams) => {
    const defaultAddress = 'A1:Z1000' // Match Google Sheets default logic

    // If we came from the worksheets listing (no range provided), resolve first sheet name then fetch range
    if (response.url.includes('/workbook/worksheets?')) {
      const listData = await response.json()
      const firstSheetName: string | undefined = listData?.value?.[0]?.name

      if (!firstSheetName) {
        throw new Error('No worksheets found in the Excel workbook')
      }

      const spreadsheetIdFromUrl = response.url.split('/drive/items/')[1]?.split('/')[0] || ''
      const accessToken = params?.accessToken
      if (!accessToken) {
        throw new Error('Access token is required to read Excel range')
      }

      const rangeUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(
        spreadsheetIdFromUrl
      )}/workbook/worksheets('${encodeURIComponent(firstSheetName)}')/range(address='${defaultAddress}')`

      const rangeResp = await fetch(rangeUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!rangeResp.ok) {
        // Normalize Microsoft Graph sheet/range errors to a friendly message
        throw new Error(
          'Invalid range provided or worksheet not found. Provide a range like "Sheet1!A1:B2"'
        )
      }

      const data = await rangeResp.json()

      const metadata = {
        spreadsheetId: spreadsheetIdFromUrl,
        properties: {},
        spreadsheetUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${spreadsheetIdFromUrl}`,
      }

      const result: MicrosoftExcelReadResponse = {
        success: true,
        output: {
          data: {
            range: data.range || `${firstSheetName}!${defaultAddress}`,
            values: data.values || [],
          },
          metadata: {
            spreadsheetId: metadata.spreadsheetId,
            spreadsheetUrl: metadata.spreadsheetUrl,
          },
        },
      }

      return result
    }

    // Normal path: caller supplied a range; just return the parsed result
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
}
