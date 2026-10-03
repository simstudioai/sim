import type { WorkflowLogDetail } from '@/lib/api/contracts/logs'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import type { LogsGetRunDetailsParams, LogsGetRunDetailsResponse } from '@/tools/logs/types'
import type { InternalToolConfig } from '@/tools/types'

export const logsGetRunDetailsTool: InternalToolConfig<
  LogsGetRunDetailsParams,
  LogsGetRunDetailsResponse
> = {
  id: 'logs_get_run_details',
  name: 'Get Run Details',
  description:
    'Fetch details for a single workflow run by its run ID, including the full trace spans.',
  version: '1.0.0',

  params: {
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The run ID to fetch details for',
    },
  },

  operation: {
    input: (params) => ({ executionId: params.runId }),
  },

  transformResponse: async (response): Promise<LogsGetRunDetailsResponse> => {
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result?.error || `Request failed with status ${response.status}`)
    }
    const detail: WorkflowLogDetail = result.data

    return {
      success: true,
      output: {
        runId: detail.executionId ?? '',
        workflowId: detail.workflowId ?? null,
        workflowName: detail.workflow?.name ?? null,
        status: detail.status ?? detail.level,
        trigger: detail.trigger ?? null,
        startedAt: detail.createdAt,
        durationMs: detail.executionData?.totalDuration ?? null,
        // Costs are stored in dollars; credits are the user-facing unit.
        cost: detail.cost?.total != null ? dollarsToCredits(detail.cost.total) : null,
        traceSpans: detail.executionData?.traceSpans ?? [],
        finalOutput: detail.executionData?.finalOutput ?? null,
      },
    }
  },

  outputs: {
    runId: { type: 'string', description: 'The run ID' },
    workflowId: { type: 'string', description: 'Workflow ID this run belongs to' },
    workflowName: { type: 'string', description: 'Workflow name' },
    status: { type: 'string', description: 'Run status' },
    trigger: { type: 'string', description: 'How the run was triggered' },
    startedAt: { type: 'string', description: 'Run start time (ISO 8601)' },
    durationMs: { type: 'number', description: 'Run duration in milliseconds' },
    cost: { type: 'number', description: 'Run cost in credits' },
    traceSpans: { type: 'array', description: 'Full trace spans for the run' },
    finalOutput: { type: 'json', description: 'Final output of the run' },
  },
}
