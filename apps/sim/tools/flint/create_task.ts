import { filterUndefined } from '@sim/utils/object'
import type { FlintCreateTaskParams, FlintCreateTaskResponse } from '@/tools/flint/types'
import { FLINT_API_BASE_URL, flintBaseParamFields, flintHeaders } from '@/tools/flint/utils'
import type { ToolConfig } from '@/tools/types'

export const flintCreateTaskTool: ToolConfig<FlintCreateTaskParams, FlintCreateTaskResponse> = {
  id: 'flint_create_task',
  name: 'Flint Create Task',
  description:
    'Start a background Flint agent task that modifies a site from a natural-language prompt.',
  version: '1.0.0',

  params: {
    ...flintBaseParamFields,
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the Flint site the agent should modify',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Natural-language instructions for the agent (e.g., "Add a new About page with a team section")',
    },
    callbackUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'HTTPS webhook URL that Flint will POST to when the task completes or fails',
    },
    publish: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to automatically publish the changes when the task completes',
    },
  },

  request: {
    url: `${FLINT_API_BASE_URL}/agent/tasks`,
    method: 'POST',
    headers: (params) => flintHeaders(params),
    body: (params) =>
      filterUndefined({
        siteId: params.siteId,
        prompt: params.prompt,
        callbackUrl: params.callbackUrl,
        publish: params.publish,
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data?.taskId) {
      throw new Error(data?.error || 'Flint did not return a task ID')
    }
    return {
      success: true,
      output: {
        taskId: data.taskId ?? null,
        status: data.status ?? null,
        createdAt: data.createdAt ?? null,
      },
    }
  },

  outputs: {
    taskId: { type: 'string', description: 'Identifier of the created background task' },
    status: { type: 'string', description: 'Initial task status (running)' },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp when the task was created' },
  },
}
