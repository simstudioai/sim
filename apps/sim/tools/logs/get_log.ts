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
    url: (params) => `/api/logs/${encodeURIComponent(params.id)}`,
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<LogsGetResponse> => {
    const result = await response.json()
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
