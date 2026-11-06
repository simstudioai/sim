import { filterUndefined } from '@sim/utils/object'
import { UserFailure } from '@/lib/core/errors/user-failure'
import type {
  DatabricksCancelAllRunsParams,
  DatabricksSuccessResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const cancelAllRunsTool: ToolConfig<
  DatabricksCancelAllRunsParams,
  DatabricksSuccessResponse
> = {
  id: 'databricks_cancel_all_runs',
  name: 'Databricks Cancel All Runs',
  description: 'Request cancellation of active runs of a job or queued runs in the workspace.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    jobId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job identifier; required unless allQueuedRuns is true',
    },
    allQueuedRuns: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cancel queued runs; without a job ID this applies to the workspace',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/runs/cancel-all`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.jobId == null && params.allQueuedRuns !== true) {
        throw new UserFailure(
          'Provide jobId or set allQueuedRuns to true to cancel queued workspace runs'
        )
      }
      return filterUndefined({
        job_id: params.jobId,
        all_queued_runs: params.allQueuedRuns,
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok)
      throw new Error(await readDatabricksError(response, 'Failed to cancel all runs'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
