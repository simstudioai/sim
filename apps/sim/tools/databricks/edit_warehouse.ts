import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksEditWarehouseParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const editWarehouseTool: ToolConfig<
  DatabricksEditWarehouseParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_edit_warehouse',
  name: 'Databricks Edit Warehouse',
  description: 'Update a SQL warehouse configuration.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    warehouseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SQL warehouse identifier',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name of the SQL warehouse',
    },
    clusterSize: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SQL warehouse size, such as Small or Medium',
    },
    minNumClusters: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum number of SQL warehouse clusters',
    },
    maxNumClusters: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of SQL warehouse clusters',
    },
    autoStopMins: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Idle minutes before stopping the warehouse; 0 disables automatic stopping',
    },
    creatorName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse creator name',
    },
    warehouseTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse tags as {custom_tags: [{key, value}]}',
    },
    spotInstancePolicy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cost or reliability preference for spot instances',
    },
    enablePhoton: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable Photon for SQL warehouse compute',
    },
    channel: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse release channel as {name: "CHANNEL_NAME_CURRENT"}',
    },
    enableServerlessCompute: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use serverless SQL warehouse compute',
    },
    warehouseType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse type; use PRO for serverless',
    },
    statementTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Warehouse statement timeout in seconds',
    },
  },
  request: {
    url: (params) =>
      databricksUrl(
        params.host,
        `/api/2.0/sql/warehouses/${safeUrlPathSegment(params.warehouseId, 'warehouseId')}/edit`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        name: optionalDatabricksString(params.name),
        cluster_size: optionalDatabricksString(params.clusterSize),
        min_num_clusters: params.minNumClusters,
        max_num_clusters: params.maxNumClusters,
        auto_stop_mins: params.autoStopMins,
        creator_name: optionalDatabricksString(params.creatorName),
        tags: parseDatabricksJson(params.warehouseTags, 'warehouseTags', 'object'),
        spot_instance_policy: optionalDatabricksString(params.spotInstancePolicy),
        enable_photon: params.enablePhoton,
        channel: parseDatabricksJson(params.channel, 'channel', 'object'),
        enable_serverless_compute: params.enableServerlessCompute,
        warehouse_type: optionalDatabricksString(params.warehouseType),
        statement_timeout: params.statementTimeout,
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to edit warehouse'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
