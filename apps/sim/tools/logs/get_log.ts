import type { LogsGetParams, LogsGetResponse } from '@/tools/logs/types'
import type { ToolConfig } from '@/tools/types'

export const logsGetTool: ToolConfig<LogsGetParams, LogsGetResponse> = {
  id: 'logs_get',
  name: 'Get Log by ID',
  description: 'Fetch a single workflow execution log entry by its log ID.',
  version: '1.0.0',

  params: {
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log entry ID',
    },
  },

  request: {
    url: (params) => {
      const workspaceId = params._context?.workspaceId
      if (!workspaceId) {
        throw new Error('workspaceId is required in execution context')
      }
      const qs = new URLSearchParams({ workspaceId })
      return `/api/logs/${encodeURIComponent(params.id)}?${qs.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<LogsGetResponse> => {
    const result = await response.json()
    if (!response.ok) {
      throw new Error(result?.error || `Request failed with status ${response.status}`)
    }
    return {
      success: true,
      output: {
        log: result.data,
      },
    }
  },

  outputs: {
    log: { type: 'json', description: 'Workflow execution log entry' },
  },
}
