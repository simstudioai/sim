import { filterUndefined } from '@sim/utils/object'
import type { DatabricksDeleteRunParams, DatabricksSuccessResponse } from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  readDatabricksError,
} from '@/tools/databricks/utils'
import { DATABRICKS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const deleteRunTool: ToolConfig<DatabricksDeleteRunParams, DatabricksSuccessResponse> = {
  id: 'databricks_delete_run',
  name: 'Databricks Delete Run',
  description: 'Delete a completed Databricks job run.',
  version: '1.0.0',
  oauth: DATABRICKS_CREDENTIAL_OAUTH,
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    runId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Run identifier',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/runs/delete`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return filterUndefined({
        run_id: params.runId,
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to delete run'))
    return { success: true, output: { success: true } }
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether Databricks accepted the request' },
  },
}
