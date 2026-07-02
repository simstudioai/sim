import type {
  GoogleAppsheetDeleteParams,
  GoogleAppsheetDeleteResponse,
} from '@/tools/google_appsheet/types'
import { buildAppsheetActionUrl } from '@/tools/google_appsheet/utils'
import type { ToolConfig } from '@/tools/types'

export const googleAppsheetDeleteRowsTool: ToolConfig<
  GoogleAppsheetDeleteParams,
  GoogleAppsheetDeleteResponse
> = {
  id: 'google_appsheet_delete_rows',
  name: 'AppSheet Delete Rows',
  description:
    'Delete rows from an AppSheet table. Each row only needs to include the key column name and value.',
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
      description: 'Name of the table to delete rows from',
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
        'Array of row objects identifying rows to delete by key column, e.g. [{ "RowID": "123" }]',
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
      Action: 'Delete',
      Properties: {},
      Rows: params.rows,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'Failed to delete AppSheet rows')
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
      description: 'Rows deleted by AppSheet',
      items: {
        type: 'object',
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        rowCount: { type: 'number', description: 'Number of rows deleted' },
      },
    },
  },
}
