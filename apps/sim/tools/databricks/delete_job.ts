import { filterUndefined } from '@sim/utils/object'
import type { DatabricksDeleteJobParams, DatabricksSuccessResponse } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteJobTool: ToolConfig<DatabricksDeleteJobParams, DatabricksSuccessResponse> = {
  id: 'databricks_delete_job',
  name: 'Databricks Delete Job',
  description: 'Delete a Databricks job and cancel its active runs.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    jobId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job identifier',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/delete`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        job_id: params.jobId,
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to delete job'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
