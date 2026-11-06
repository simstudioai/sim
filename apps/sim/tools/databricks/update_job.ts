import { filterUndefined } from '@sim/utils/object'
import type { DatabricksSuccessResponse, DatabricksUpdateJobParams } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const updateJobTool: ToolConfig<DatabricksUpdateJobParams, DatabricksSuccessResponse> = {
  id: 'databricks_update_job',
  name: 'Databricks Update Job',
  description:
    'Merge selected settings into a Databricks job and optionally remove settings or tasks.',
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
      required: false,
      visibility: 'user-or-llm',
      description:
        'Job settings in Databricks API format; Update merges top-level fields and task keys, Reset replaces all settings',
    },
    fieldsToRemove: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Settings to remove, such as ["schedule", "tasks/task_key"]',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/update`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        job_id: params.jobId,
        new_settings: parseDatabricksJson(params.newSettings, 'newSettings', 'object'),
        fields_to_remove: parseDatabricksJson(params.fieldsToRemove, 'fieldsToRemove', 'array'),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to update job'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
