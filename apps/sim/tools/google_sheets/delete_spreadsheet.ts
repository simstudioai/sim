import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface GoogleSheetsV2DeleteSpreadsheetParams {
  accessToken: string
  spreadsheetId: string
}

export interface GoogleSheetsV2DeleteSpreadsheetResponse extends ToolResponse {
  output: {
    spreadsheetId: string
    deleted: boolean
  }
}

export const deleteSpreadsheetV2Tool: ToolConfig<
  GoogleSheetsV2DeleteSpreadsheetParams,
  GoogleSheetsV2DeleteSpreadsheetResponse
> = {
  id: 'google_sheets_delete_spreadsheet_v2',
  name: 'Delete Spreadsheet V2',
  description: 'Permanently delete a Google Sheets spreadsheet using the Google Drive API',
  version: '2.0.0',

  oauth: {
    required: true,
    provider: 'google-sheets',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Sheets API',
    },
    spreadsheetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the Google Sheets spreadsheet to delete',
    },
  },

  request: {
    url: (params) => {
      const spreadsheetId = params.spreadsheetId?.trim()
      if (!spreadsheetId) {
        throw new Error('Spreadsheet ID is required')
      }

      return `https://www.googleapis.com/drive/v3/files/${spreadsheetId}`
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

  transformResponse: async (response: Response, params?: GoogleSheetsV2DeleteSpreadsheetParams) => {
    const spreadsheetId = params?.spreadsheetId ?? ''

    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          spreadsheetId,
          deleted: true,
        },
      }
    }

    const data = await response.json()
    throw new Error(data.error?.message ?? 'Failed to delete spreadsheet')
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'The ID of the deleted spreadsheet' },
    deleted: { type: 'boolean', description: 'Whether the spreadsheet was successfully deleted' },
  },
}
