import type {
  DatabricksBaseParams,
  DatabricksListWarehousesResponse,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'

export const listWarehousesTool: ToolConfig<
  DatabricksBaseParams,
  DatabricksListWarehousesResponse
> = {
  id: 'databricks_list_warehouses',
  name: 'Databricks List Warehouses',
  description:
    'List all SQL warehouses in a Databricks workspace including their size, state, and type. Use this to discover the warehouse ID needed for Execute SQL.',
  version: '1.0.0',

  params: {
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
      const host = params.host
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')
      return `https://${host}/api/2.0/sql/warehouses`
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

    const warehouses = (data.warehouses ?? []).map(
      (warehouse: {
        id?: string
        name?: string
        cluster_size?: string
        state?: string
        warehouse_type?: string
        creator_name?: string
        auto_stop_mins?: number
        num_clusters?: number
        min_num_clusters?: number
        max_num_clusters?: number
        num_active_sessions?: number
        enable_serverless_compute?: boolean
      }) => ({
        warehouseId: warehouse.id ?? '',
        name: warehouse.name ?? '',
        clusterSize: warehouse.cluster_size ?? '',
        state: warehouse.state ?? 'UNKNOWN',
        warehouseType: warehouse.warehouse_type ?? '',
        creatorName: warehouse.creator_name ?? '',
        autoStopMinutes: warehouse.auto_stop_mins ?? 0,
        numClusters: warehouse.num_clusters ?? 0,
        minNumClusters: warehouse.min_num_clusters ?? 0,
        maxNumClusters: warehouse.max_num_clusters ?? 0,
        numActiveSessions: warehouse.num_active_sessions ?? 0,
        enableServerlessCompute: warehouse.enable_serverless_compute ?? false,
      })
    )

    return {
      success: true,
      output: {
        warehouses,
      },
    }
  },

  outputs: {
    warehouses: {
      type: 'array',
      description: 'List of SQL warehouses in the workspace',
      items: {
        type: 'object',
        properties: {
          warehouseId: { type: 'string', description: 'Unique warehouse identifier' },
          name: { type: 'string', description: 'Warehouse display name' },
          clusterSize: {
            type: 'string',
            description: 'Warehouse size (e.g., 2X-Small, Small, Medium, Large)',
          },
          state: {
            type: 'string',
            description: 'Current state (STARTING, RUNNING, STOPPING, STOPPED, DELETING, DELETED)',
          },
          warehouseType: { type: 'string', description: 'Warehouse type (CLASSIC, PRO)' },
          creatorName: { type: 'string', description: 'Email of the warehouse creator' },
          autoStopMinutes: {
            type: 'number',
            description: 'Minutes of inactivity before auto-stop (0 = disabled)',
          },
          numClusters: { type: 'number', description: 'Current number of running clusters' },
          minNumClusters: { type: 'number', description: 'Minimum cluster count for scaling' },
          maxNumClusters: { type: 'number', description: 'Maximum cluster count for scaling' },
          numActiveSessions: { type: 'number', description: 'Number of active sessions' },
          enableServerlessCompute: {
            type: 'boolean',
            description: 'Whether serverless compute is enabled',
          },
        },
      },
    },
  },
}
