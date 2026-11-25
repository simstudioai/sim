import type {
  GoogleSheetsAppendResponse,
  GoogleSheetsToolParams,
  GoogleSheetsV2AppendResponse,
  GoogleSheetsV2ToolParams,
} from '@/tools/google_sheets/types'
import {
  appendResponseRenderParams,
  appendSheetRows,
  mapValueRange,
  RESPONSE_RENDER_PARAMS,
  sheetWritePlaceholder,
  UPDATED_DATA_OUTPUT,
} from '@/tools/google_sheets/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const appendTool: ToolConfig<GoogleSheetsToolParams, GoogleSheetsAppendResponse> = {
  id: 'google_sheets_append',
  name: 'Append to Google Sheets',
  description: 'Append data to the end of a Google Sheets spreadsheet',
  version: '1.0',
  effect: 'write',

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
      description: 'The ID of the spreadsheet to append to',
    },
    range: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The A1 notation range to append after (e.g. "Sheet1", "Sheet1!A:D")',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The data to append as a 2D array (e.g. [["Alice", 30], ["Bob", 25]]) or array of objects.',
    },
    valueInputOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The format of the data to append',
    },
    insertDataOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'How to insert the data (OVERWRITE or INSERT_ROWS)',
    },
    includeValuesInResponse: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Whether to include the appended values in the response',
    },
  },

  request: {
    url: (params) => {
      // If range is not provided, use a default range for the first sheet
      const range = params.range || 'Sheet1'

      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${safeUrlPathSegment(params.spreadsheetId, 'spreadsheetId')}/values/${encodeURIComponent(range)}:append`
      )

      // Default to USER_ENTERED if not specified
      const valueInputOption = params.valueInputOption || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)

      // Only send insertDataOption when the user provides it; the API defaults to OVERWRITE
      if (params.insertDataOption) {
        url.searchParams.append('insertDataOption', params.insertDataOption)
      }

      if (params.includeValuesInResponse) {
        url.searchParams.append('includeValuesInResponse', 'true')
      }

      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      majorDimension: params.majorDimension || 'ROWS',
      values: appendSheetRows(params.values),
      ...(params.range ? { range: params.range } : {}),
    }),
  },

  dryRunOutput: (params) => sheetWritePlaceholder(params, appendSheetRows(params.values)),

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract spreadsheet ID from the URL (guard if url is missing)
    const urlParts = typeof response.url === 'string' ? response.url.split('/spreadsheets/') : []
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    // Create a simple metadata object with just the ID and URL
    const metadata = {
      spreadsheetId,
      properties: {},
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }

    const result = {
      success: true,
      output: {
        tableRange: data.tableRange || '',
        updatedRange: data.updates?.updatedRange || '',
        updatedRows: data.updates?.updatedRows || 0,
        updatedColumns: data.updates?.updatedColumns || 0,
        updatedCells: data.updates?.updatedCells || 0,
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }

    return result
  },

  outputs: {
    tableRange: { type: 'string', description: 'Range of the table where data was appended' },
    updatedRange: { type: 'string', description: 'Range of cells that were updated' },
    updatedRows: { type: 'number', description: 'Number of rows updated' },
    updatedColumns: { type: 'number', description: 'Number of columns updated' },
    updatedCells: { type: 'number', description: 'Number of cells updated' },
    metadata: {
      type: 'json',
      description: 'Spreadsheet metadata including ID and URL',
      properties: {
        spreadsheetId: { type: 'string', description: 'Google Sheets spreadsheet ID' },
        spreadsheetUrl: { type: 'string', description: 'Spreadsheet URL' },
      },
    },
  },
}

export const appendV2Tool: ToolConfig<GoogleSheetsV2ToolParams, GoogleSheetsV2AppendResponse> = {
  id: 'google_sheets_append_v2',
  name: 'Append to Google Sheets V2',
  description: 'Append data to the end of a specific sheet in a Google Sheets spreadsheet',
  version: '2.0.0',
  effect: 'write',

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
      description: 'Google Sheets spreadsheet ID',
    },
    sheetName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the sheet/tab to append to',
    },
    values: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The data to append as a 2D array (e.g. [["Alice", 30], ["Bob", 25]]) or array of objects.',
    },
    valueInputOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'The format of the data to append',
    },
    insertDataOption: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'How to insert the data (OVERWRITE or INSERT_ROWS)',
    },
    includeValuesInResponse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the appended values in the response',
    },
    ...RESPONSE_RENDER_PARAMS,
  },

  request: {
    url: (params) => {
      const sheetName = params.sheetName?.trim()
      if (!sheetName) {
        throw new Error('Sheet name is required')
      }

      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${safeUrlPathSegment(params.spreadsheetId, 'spreadsheetId')}/values/${encodeURIComponent(sheetName)}:append`
      )

      const valueInputOption = params.valueInputOption || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)

      if (params.insertDataOption) {
        url.searchParams.append('insertDataOption', params.insertDataOption)
      }

      if (params.includeValuesInResponse) {
        url.searchParams.append('includeValuesInResponse', 'true')
      }
      appendResponseRenderParams(url.searchParams, params)

      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      majorDimension: params.majorDimension || 'ROWS',
      values: appendSheetRows(params.values),
    }),
  },

  dryRunOutput: (params) => sheetWritePlaceholder(params, appendSheetRows(params.values)),

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const urlParts = typeof response.url === 'string' ? response.url.split('/spreadsheets/') : []
    const spreadsheetId = urlParts[1]?.split('/')[0] || ''

    const metadata = {
      spreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    }

    return {
      success: true,
      output: {
        tableRange: data.tableRange ?? '',
        updatedRange: data.updates?.updatedRange ?? '',
        updatedRows: data.updates?.updatedRows ?? 0,
        updatedColumns: data.updates?.updatedColumns ?? 0,
        updatedCells: data.updates?.updatedCells ?? 0,
        updatedData: mapValueRange(data.updates?.updatedData),
        metadata: {
          spreadsheetId: metadata.spreadsheetId,
          spreadsheetUrl: metadata.spreadsheetUrl,
        },
      },
    }
  },

  outputs: {
    tableRange: { type: 'string', description: 'Range of the table where data was appended' },
    updatedRange: { type: 'string', description: 'Range of cells that were updated' },
    updatedRows: { type: 'number', description: 'Number of rows updated' },
    updatedColumns: { type: 'number', description: 'Number of columns updated' },
    updatedCells: { type: 'number', description: 'Number of cells updated' },
    updatedData: UPDATED_DATA_OUTPUT,
    metadata: {
      type: 'json',
      description: 'Spreadsheet metadata including ID and URL',
      properties: {
        spreadsheetId: { type: 'string', description: 'Google Sheets spreadsheet ID' },
        spreadsheetUrl: { type: 'string', description: 'Spreadsheet URL' },
      },
    },
  },
}
