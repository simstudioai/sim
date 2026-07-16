import {
  ROCKETLANE_API_BASE,
  type RocketlaneDeleteTaskParams,
  type RocketlaneTaskDeleteResponse,
  rocketlaneError,
  rocketlaneHeaders,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneDeleteTaskTool: ToolConfig<
  RocketlaneDeleteTaskParams,
  RocketlaneTaskDeleteResponse
> = {
  id: 'rocketlane_delete_task',
  name: 'Rocketlane Delete Task',
  description: 'Permanently delete a Rocketlane task by its unique identifier',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    taskId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the task to delete',
    },
  },

  request: {
    url: (params) => `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}`,
    method: 'DELETE',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response, params?: RocketlaneDeleteTaskParams) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    return {
      success: true,
      output: { deleted: true, taskId: params?.taskId ?? null },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the task was deleted' },
    taskId: { type: 'number', description: 'ID of the deleted task', optional: true },
  },
}
