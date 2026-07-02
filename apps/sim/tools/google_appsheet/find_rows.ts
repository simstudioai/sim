import type {
  GoogleAppsheetFindParams,
  GoogleAppsheetFindResponse,
} from '@/tools/google_appsheet/types'
import { buildAppsheetActionUrl } from '@/tools/google_appsheet/utils'
import type { ToolConfig } from '@/tools/types'

export const googleAppsheetFindRowsTool: ToolConfig<
  GoogleAppsheetFindParams,
  GoogleAppsheetFindResponse
> = {
  id: 'google_appsheet_find_rows',
  name: 'AppSheet Find Rows',
  description:
    'Read rows from an AppSheet table. Omit the selector to return every row, or provide a Selector expression (Filter/Select/OrderBy/Top) to narrow and shape the results.',
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
      description: 'Name of the table to read from',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'AppSheet region subdomain: "www" (global, default), "eu", or "asia-southeast"',
    },
    selector: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional AppSheet expression to filter/sort/limit rows, e.g. Filter(TableName, [Age] >= 21) or Top(OrderBy(Filter(TableName, true), [LastName], true), 10)',
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
      Action: 'Find',
      Properties: params.selector ? { Selector: params.selector } : {},
      Rows: [],
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'Failed to find AppSheet rows')
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
      description: 'Matching rows returned by AppSheet',
      items: {
        type: 'object',
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        rowCount: { type: 'number', description: 'Number of rows returned' },
      },
    },
  },
}
