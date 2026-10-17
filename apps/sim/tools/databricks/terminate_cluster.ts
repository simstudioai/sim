import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksSuccessResponse,
  DatabricksTerminateClusterParams,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const terminateClusterTool: ToolConfig<
  DatabricksTerminateClusterParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_terminate_cluster',
  name: 'Databricks Terminate Cluster',
  description: 'Terminate a compute cluster while retaining its configuration for a later restart.',
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
    url: (params) => databricksUrl(params.host, `/api/2.1/clusters/delete`),
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
      throw new Error(await readDatabricksError(response, 'Failed to terminate cluster'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
