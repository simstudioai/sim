import type {
  GoogleAppsheetEditParams,
  GoogleAppsheetEditResponse,
} from '@/tools/google_appsheet/types'
import { buildAppsheetActionUrl } from '@/tools/google_appsheet/utils'
import type { ToolConfig } from '@/tools/types'

export const googleAppsheetEditRowsTool: ToolConfig<
  GoogleAppsheetEditParams,
  GoogleAppsheetEditResponse
> = {
  id: 'google_appsheet_edit_rows',
  name: 'AppSheet Edit Rows',
  description:
    'Update existing rows in an AppSheet table. Each row must explicitly include the key column name and value, plus any columns to change.',
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
      description: 'Name of the table to update rows in',
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
        'Array of row objects to update, each including the key column and the columns to change, e.g. [{ "RowID": "123", "Status": "Done" }]',
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
      Action: 'Edit',
      Properties: {},
      Rows: params.rows,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'Failed to edit AppSheet rows')
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
      description: 'Rows updated by AppSheet',
      items: {
        type: 'object',
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        rowCount: { type: 'number', description: 'Number of rows updated' },
      },
    },
  },
}
