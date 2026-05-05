import type { LogsGetExecutionParams, LogsGetExecutionResponse } from '@/tools/logs/types'
import type { ToolConfig } from '@/tools/types'

export const logsGetExecutionTool: ToolConfig<LogsGetExecutionParams, LogsGetExecutionResponse> = {
  id: 'logs_get_execution',
  name: 'Get Execution Details',
  description:
    'Fetch full execution details for a workflow run, including the per-block state snapshot.',
  version: '1.0.0',

  params: {
    executionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Execution ID returned by a workflow run',
    },
  },

  request: {
    url: (params) => `/api/logs/execution/${encodeURIComponent(params.executionId)}`,
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<LogsGetExecutionResponse> => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with status ${response.status}`)
    }
    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    executionId: { type: 'string', description: 'Execution ID' },
    workflowId: { type: 'string', description: 'Workflow ID this execution belongs to' },
    workflowState: { type: 'json', description: 'Per-block state snapshot for the execution' },
    childWorkflowSnapshots: {
      type: 'json',
      description: 'Snapshots for any child workflows invoked during the run',
      optional: true,
    },
    executionMetadata: {
      type: 'json',
      description: 'Trigger, timestamps, totalDurationMs, and cost for the run',
    },
  },
}
