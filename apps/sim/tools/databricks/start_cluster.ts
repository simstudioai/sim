import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksStartClusterParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const startClusterTool: ToolConfig<DatabricksStartClusterParams, DatabricksSuccessResponse> =
  {
    id: 'databricks_start_cluster',
    name: 'Databricks Start Cluster',
    description: 'Start a terminated all-purpose compute cluster.',
    version: '1.0.0',
    params: {
      ...DATABRICKS_AUTH_PARAMS,
      clusterId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Compute cluster identifier',
      },
    },
    request: {
      url: (params) => databricksUrl(params.host, `/api/2.1/clusters/start`),
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        return filterUndefined({
          cluster_id: params.clusterId?.trim(),
        })
      },
    },
    transformResponse: async (response) => {
      if (!response.ok)
        throw new Error(await readDatabricksError(response, 'Failed to start cluster'))
      return { success: true, output: { success: true } }
    },
    outputs: {
      success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
    },
  }
