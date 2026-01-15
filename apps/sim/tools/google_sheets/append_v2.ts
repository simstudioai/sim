import type {
  GoogleSheetsV2AppendResponse,
  GoogleSheetsV2ToolParams,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const appendV2Tool: ToolConfig<GoogleSheetsV2ToolParams, GoogleSheetsV2AppendResponse> = {
  id: 'google_sheets_append_v2',
  name: 'Append to Google Sheets V2',
  description: 'Append data to the end of a specific sheet in a Google Sheets spreadsheet',
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
      visibility: 'user-only',
      description: 'The ID of the spreadsheet to append to',
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
      visibility: 'hidden',
      description: 'Whether to include the appended values in the response',
    },
  },

  request: {
    url: (params) => {
      const sheetName = params.sheetName?.trim()
      if (!sheetName) {
        throw new Error('Sheet name is required')
      }

      const url = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encodeURIComponent(sheetName)}:append`
      )

      const valueInputOption = params.valueInputOption || 'USER_ENTERED'
      url.searchParams.append('valueInputOption', valueInputOption)

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
    body: (params) => {
      let processedValues: any = params.values || []

      if (typeof processedValues === 'string') {
        try {
          processedValues = JSON.parse(processedValues)
        } catch (_error) {
          try {
            const sanitizedInput = (processedValues as string)
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t')
            processedValues = JSON.parse(sanitizedInput)
          } catch (_secondError) {
            processedValues = [[processedValues]]
          }
        }
      }

      if (
        Array.isArray(processedValues) &&
        processedValues.length > 0 &&
        typeof processedValues[0] === 'object' &&
        !Array.isArray(processedValues[0])
      ) {
        const allKeys = new Set<string>()
        processedValues.forEach((obj: any) => {
          if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach((key) => allKeys.add(key))
          }
        })
        const headers = Array.from(allKeys)

        const rows = processedValues.map((obj: any) => {
          if (!obj || typeof obj !== 'object') {
            return Array(headers.length).fill('')
          }
          return headers.map((key) => {
            const value = obj[key]
            if (value !== null && typeof value === 'object') {
              return JSON.stringify(value)
            }
            return value === undefined ? '' : value
          })
        })

        processedValues = [headers, ...rows]
      } else if (!Array.isArray(processedValues)) {
        processedValues = [[String(processedValues)]]
      } else if (!processedValues.every((item: any) => Array.isArray(item))) {
        processedValues = (processedValues as any[]).map((row: any) =>
          Array.isArray(row) ? row : [String(row)]
        )
      }

      const body: Record<string, any> = {
        majorDimension: params.majorDimension || 'ROWS',
        values: processedValues,
      }

      return body
    },
  },

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
