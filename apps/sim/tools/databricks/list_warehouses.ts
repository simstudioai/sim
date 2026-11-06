import type {
  DatabricksListWarehousesParams,
  DatabricksListWarehousesResponse,
} from '@/tools/databricks/types'
import { WAREHOUSE_OUTPUT_PROPERTIES } from '@/tools/databricks/types'
import { databricksUrl, mapWarehouse } from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const listWarehousesTool: ToolConfig<
  DatabricksListWarehousesParams,
  DatabricksListWarehousesResponse
> = {
  id: 'databricks_list_warehouses',
  name: 'Databricks List Warehouses',
  description:
    'List a page of SQL warehouses in a Databricks workspace including their size, state, and type. Use this to discover the warehouse ID needed for Execute SQL.',
  version: '1.0.0',

  params: {
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resources per page (default 20)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token returned by the previous list request',
    },
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks workspace host (e.g., dbc-abc123.cloud.databricks.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Databricks Personal Access Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(databricksUrl(params.host, '/api/2.0/sql/warehouses'))
      url.searchParams.set('page_size', String(params.pageSize ?? 20))
      if (params.pageToken) url.searchParams.set('page_token', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error?.message || 'Failed to list warehouses')
    }

    const warehouses = (data.warehouses ?? []).map(mapWarehouse)

    return {
      success: true,
      output: {
        warehouses,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    nextPageToken: { type: 'string', nullable: true, description: 'Token for the next page' },
    warehouses: {
      type: 'array',
      description: 'List of SQL warehouses in the workspace',
      items: {
        type: 'object',
        properties: WAREHOUSE_OUTPUT_PROPERTIES,
      },
    },
  },
}
