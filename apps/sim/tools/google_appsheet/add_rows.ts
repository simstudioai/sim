import type {
  GoogleAppsheetAddParams,
  GoogleAppsheetAddResponse,
} from '@/tools/google_appsheet/types'
import { buildAppsheetActionUrl } from '@/tools/google_appsheet/utils'
import type { ToolConfig } from '@/tools/types'

export const googleAppsheetAddRowsTool: ToolConfig<
  GoogleAppsheetAddParams,
  GoogleAppsheetAddResponse
> = {
  id: 'google_appsheet_add_rows',
  name: 'AppSheet Add Rows',
  description:
    'Add new rows to an AppSheet table. The key column value must be provided explicitly, or omitted when its Initial value expression generates it automatically (e.g. UNIQUEID()).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AppSheet Application Access Key',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'AppSheet app ID (found in App > Settings > Integrations > IN)',
    },
    tableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the table to add rows to',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'AppSheet region subdomain: "www" (global, default), "eu", or "asia-southeast"',
    },
    rows: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of row objects to add, each a column-name/value map, e.g. [{ "FirstName": "Jan", "LastName": "Jones" }]',
    },
  },

  request: {
    url: (params) => buildAppsheetActionUrl(params.appId, params.tableName, params.region),
    method: 'POST',
    headers: (params) => ({
      ApplicationAccessKey: params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      Action: 'Add',
      Properties: {},
      Rows: params.rows,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'Failed to add AppSheet rows')
    }

    const rows = data.Rows ?? data.rows ?? []

    return {
      success: true,
      output: {
        rows,
        metadata: {
          rowCount: rows.length,
        },
      },
    }
  },

  outputs: {
    rows: {
      type: 'array',
      description: 'Rows added by AppSheet, including any generated key values',
      items: {
        type: 'object',
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        rowCount: { type: 'number', description: 'Number of rows added' },
      },
    },
  },
}
