import { filterUndefined } from '@sim/utils/object'
import type { DatabricksResetJobParams, DatabricksSuccessResponse } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const resetJobTool: ToolConfig<DatabricksResetJobParams, DatabricksSuccessResponse> = {
  id: 'databricks_reset_job',
  name: 'Databricks Reset Job',
  description: 'Replace all settings of a Databricks job.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    jobId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job identifier',
    },
    newSettings: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Job settings in Databricks API format; Update merges top-level fields and task keys, Reset replaces all settings',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/reset`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        job_id: params.jobId,
        new_settings: parseDatabricksJson(params.newSettings, 'newSettings', 'object'),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to reset job'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
