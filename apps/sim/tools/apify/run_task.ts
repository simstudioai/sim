import type { RunTaskParams, RunTaskResult } from '@/tools/apify/types'
import { resolveApifyTimeoutParam } from '@/tools/apify/utils'
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
    taskTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Timeout in seconds for the run. Use 0 for no timeout. Example: 300 for 5 minutes',
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
      const timeoutParam = resolveApifyTimeoutParam(params.taskTimeout)
      if (timeoutParam !== undefined) {
        queryParams.set('timeout', timeoutParam)
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
        output: { success: false, items: [] },
        error: `APIFY API error: ${errorText}`,
      }
    }

    const items = await response.json()
    return {
      success: true,
      output: {
        success: true,
        items: Array.isArray(items) ? items : [],
      },
    }
  },

  /**
   * Same contract as `apify_run_actor_sync`: the task sync endpoint returns dataset items
   * with no run identifier and no run status, so neither is synthesized here.
   */
  outputs: {
    success: {
      type: 'boolean',
      description: "Whether the request returned dataset items (not the run's own terminal status)",
    },
    items: { type: 'array', description: 'Dataset items produced by the run' },
  },
}
