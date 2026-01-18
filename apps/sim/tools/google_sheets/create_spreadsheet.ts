import type {
  GoogleSheetsV2CreateSpreadsheetParams,
  GoogleSheetsV2CreateSpreadsheetResponse,
} from '@/tools/google_sheets/types'
import type { ToolConfig } from '@/tools/types'

export const createSpreadsheetV2Tool: ToolConfig<
  GoogleSheetsV2CreateSpreadsheetParams,
  GoogleSheetsV2CreateSpreadsheetResponse
> = {
  id: 'google_sheets_create_spreadsheet_v2',
  name: 'Create Spreadsheet V2',
  description: 'Create a new Google Sheets spreadsheet',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the new spreadsheet',
    },
    sheetTitles: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of sheet names to create (e.g., ["Sheet1", "Data", "Summary"]). Defaults to a single "Sheet1".',
    },
    locale: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The locale of the spreadsheet (e.g., "en_US")',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The time zone of the spreadsheet (e.g., "America/New_York")',
    },
  },

  request: {
    url: () => 'https://sheets.googleapis.com/v4/spreadsheets',
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
      const title = params.title?.trim()
      if (!title) {
        throw new Error('Spreadsheet title is required')
      }

      const sheetTitles = params.sheetTitles ?? ['Sheet1']
      const sheets = sheetTitles.map((sheetTitle: string, index: number) => ({
        properties: {
          title: sheetTitle,
          index,
        },
      }))

      const body: any = {
        properties: {
          title,
        },
        sheets,
      }

      if (params.locale) {
        body.properties.locale = params.locale
      }

      if (params.timeZone) {
        body.properties.timeZone = params.timeZone
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const sheets =
      data.sheets?.map((sheet: any) => ({
        sheetId: sheet.properties?.sheetId ?? 0,
        title: sheet.properties?.title ?? '',
        index: sheet.properties?.index ?? 0,
      })) ?? []

    return {
      success: true,
      output: {
        spreadsheetId: data.spreadsheetId ?? '',
        title: data.properties?.title ?? '',
        spreadsheetUrl: data.spreadsheetUrl ?? '',
        sheets,
      },
    }
  },

  outputs: {
    spreadsheetId: { type: 'string', description: 'The ID of the created spreadsheet' },
    title: { type: 'string', description: 'The title of the created spreadsheet' },
    spreadsheetUrl: { type: 'string', description: 'URL to the created spreadsheet' },
    sheets: {
      type: 'array',
      description: 'List of sheets created in the spreadsheet',
      items: {
        type: 'object',
        properties: {
          sheetId: { type: 'number', description: 'The sheet ID' },
          title: { type: 'string', description: 'The sheet title/name' },
          index: { type: 'number', description: 'The sheet index (position)' },
        },
      },
    },
  },
}
