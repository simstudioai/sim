import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksRestartClusterParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const restartClusterTool: ToolConfig<
  DatabricksRestartClusterParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_restart_cluster',
  name: 'Databricks Restart Cluster',
  description: 'Restart a running compute cluster.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    clusterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compute cluster identifier',
    },
    restartUser: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'User requesting the cluster restart',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.1/clusters/restart`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        cluster_id: params.clusterId?.trim(),
        restart_user: optionalDatabricksString(params.restartUser),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to restart cluster'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
