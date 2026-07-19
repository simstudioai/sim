import {
  mapTask,
  ROCKETLANE_API_BASE,
  type RocketlaneTaskDependenciesParams,
  type RocketlaneTaskResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TASK_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneRemoveTaskDependenciesTool: ToolConfig<
  RocketlaneTaskDependenciesParams,
  RocketlaneTaskResponse
> = {
  id: 'rocketlane_remove_task_dependencies',
  name: 'Rocketlane Remove Task Dependencies',
  description: 'Remove dependencies from a Rocketlane task',
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
      description: 'Unique identifier of the task to remove dependencies from',
    },
    dependencyTaskIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task IDs to remove from the task dependencies',
      items: { type: 'number' },
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}/remove-dependencies`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      dependencies: params.dependencyTaskIds.map((taskId) => ({ taskId })),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { task: mapTask(data) },
    }
  },

  outputs: {
    task: {
      type: 'object',
      description: 'The task with its updated dependencies',
      properties: TASK_OUTPUT_PROPERTIES,
    },
  },
}
