import type { ToolConfig } from '../types'
import type { MicrosoftExcelReadResponse, MicrosoftExcelToolParams } from './types'

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
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({ error: response.statusText }))
      const errorText =
        errorJson.error && typeof errorJson.error === 'object'
          ? errorJson.error.message || JSON.stringify(errorJson.error)
          : errorJson.error || response.statusText
      throw new Error(`Failed to read Microsoft Excel data: ${errorText}`)
    }

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
  transformError: (error) => {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        if (typeof error.error === 'string') {
          return error.error
        }
        if (typeof error.error === 'object' && error.error.message) {
          return error.error.message
        }
        return JSON.stringify(error.error)
      }

      if (error.message) {
        return error.message
      }

      try {
        return `Microsoft Excel API error: ${JSON.stringify(error)}`
      } catch (_e) {
        return 'Microsoft Excel API error: Unable to parse error details'
      }
    }

    return 'An error occurred while reading from Microsoft Excel'
  },
}
