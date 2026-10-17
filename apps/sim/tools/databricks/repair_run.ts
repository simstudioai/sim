import { filterUndefined } from '@sim/utils/object'
import type {
  DatabricksRepairRunParams,
  DatabricksRepairRunResponse,
} from '@/tools/databricks/types'
import {
  DATABRICKS_AUTH_PARAMS,
  databricksUrl,
  optionalDatabricksString,
  parseDatabricksJson,
  readDatabricksError,
} from '@/tools/databricks/utils'
import type { ToolConfig } from '@/tools/types'

export const repairRunTool: ToolConfig<DatabricksRepairRunParams, DatabricksRepairRunResponse> = {
  id: 'databricks_repair_run',
  name: 'Databricks Repair Run',
  description: 'Rerun failed or selected tasks within an existing Databricks run.',
  version: '1.0.0',
  params: {
    ...DATABRICKS_AUTH_PARAMS,
    runId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Run identifier',
    },
    latestRepairId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Most recent repair ID; required after the first repair of a run',
    },
    rerunTasks: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task keys to repair; mutually exclusive with rerunAllFailedTasks',
    },
    jobParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job-level parameter overrides as a JSON object of string keys and values',
    },
    rerunAllFailedTasks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Repair every failed task instead of specifying task keys',
    },
    rerunDependentTasks: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Also rerun tasks downstream of the selected failed tasks',
    },
    performanceTarget: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Serverless performance mode: STANDARD or PERFORMANCE_OPTIMIZED',
    },
    pipelineParams: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pipeline refresh settings, including full_refresh and selective table or flow lists',
    },
  },
  request: {
    url: (params) => databricksUrl(params.host, `/api/2.2/jobs/runs/repair`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.rerunAllFailedTasks && params.rerunTasks != null && params.rerunTasks !== '')
        throw new Error('Use rerunTasks or rerunAllFailedTasks, not both')
      return filterUndefined({
        run_id: params.runId,
        latest_repair_id: params.latestRepairId,
        rerun_tasks: parseDatabricksJson(params.rerunTasks, 'rerunTasks', 'array'),
        job_parameters: parseDatabricksJson(params.jobParameters, 'jobParameters', 'object'),
        rerun_all_failed_tasks: params.rerunAllFailedTasks,
        rerun_dependent_tasks: params.rerunDependentTasks,
        performance_target: optionalDatabricksString(params.performanceTarget),
        pipeline_params: parseDatabricksJson(params.pipelineParams, 'pipelineParams', 'object'),
      })
    },
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await readDatabricksError(response, 'Failed to repair run'))
    const data = await response.json()
    return { success: true, output: { repairId: data.repair_id ?? null } }
  },
  outputs: {
    repairId: {
      type: 'number',
      nullable: true,
      description: 'Identifier of the repair; pass it as latestRepairId on the next repair',
    },
  },
}
