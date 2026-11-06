import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksResizeClusterParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const resizeClusterTool: ToolConfig<
  DatabricksResizeClusterParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_resize_cluster',
  name: 'Databricks Resize Cluster',
  description: 'Change the fixed worker count or autoscaling range of a running cluster.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    clusterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compute cluster identifier',
    },
    numWorkers: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fixed worker count; use this or autoscale',
    },
    autoscale: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Worker range as {min_workers, max_workers}; use this or numWorkers',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.1/clusters/resize`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if ((params.numWorkers != null) === (params.autoscale != null && params.autoscale !== ''))
        throw new Error('Provide exactly one of numWorkers or autoscale')
      return filterUndefined({
        cluster_id: params.clusterId?.trim(),
        num_workers: params.numWorkers,
        autoscale: parseDatabricksJson(params.autoscale, 'autoscale', 'object'),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to resize cluster'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
