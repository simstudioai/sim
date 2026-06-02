import type { RunTaskParams, RunTaskResult } from '@/tools/apify/types'
import type { ToolConfig } from '@/tools/types'

export const apifyRunTaskTool: ToolConfig<RunTaskParams, RunTaskResult> = {
  id: 'apify_run_task',
  name: 'APIFY Run Task',
  description: 'Run a saved APIFY actor task synchronously and get dataset items (max 5 minutes)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'APIFY API token from console.apify.com/account#/integrations',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Task ID or username/task-name. Examples: "janedoe/my-task", "moJRLRc85AitArpNN"',
    },
    input: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON string that overrides the task\'s saved input. Example: {"startUrls": [{"url": "https://example.com"}]}',
    },
    itemLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max dataset items to return (1-250000). Example: 500',
    },
    memory: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Memory in megabytes allocated for the run (128-32768). Example: 1024 for 1GB',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timeout in seconds for the run. Example: 300 for 5 minutes',
    },
    build: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Actor build to run. Examples: "latest", "beta", "1.2.3"',
    },
  },

  request: {
    url: (params) => {
      const encodedTaskId = encodeURIComponent(params.taskId.trim())
      const baseUrl = `https://api.apify.com/v2/actor-tasks/${encodedTaskId}/run-sync-get-dataset-items`
      const queryParams = new URLSearchParams()

      if (params.itemLimit) {
        const limit = Math.max(1, Math.min(params.itemLimit, 250000))
        queryParams.set('limit', limit.toString())
      }
      if (params.memory) {
        queryParams.set('memory', params.memory.toString())
      }
      if (params.timeout) {
        queryParams.set('timeout', params.timeout.toString())
      }
      if (params.build) {
        queryParams.set('build', params.build)
      }

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      if (params.input) {
        try {
          return JSON.parse(params.input)
        } catch {
          throw new Error('Invalid JSON in input parameter')
        }
      }
      return {}
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        output: { success: false, status: 'ERROR', items: [] },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const items = await response.json()
    return {
      success: true,
      output: {
        success: true,
        status: 'SUCCEEDED',
        items: Array.isArray(items) ? items : [],
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the task run succeeded' },
    status: { type: 'string', description: 'Run status (SUCCEEDED, FAILED, etc.)' },
    items: { type: 'array', description: 'Dataset items produced by the run' },
  },
}
