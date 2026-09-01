import type { LogsGetParams, LogsGetResponse } from '@/tools/logs/types'
import type { InternalToolConfig } from '@/tools/types'

export const logsGetTool: InternalToolConfig<LogsGetParams, LogsGetResponse> = {
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

  operation: {
    input: (params) => ({ id: params.id }),
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
