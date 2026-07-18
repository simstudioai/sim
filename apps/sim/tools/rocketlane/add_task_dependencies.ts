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

export const rocketlaneAddTaskDependenciesTool: ToolConfig<
  RocketlaneTaskDependenciesParams,
  RocketlaneTaskResponse
> = {
  id: 'rocketlane_add_task_dependencies',
  name: 'Rocketlane Add Task Dependencies',
  description: 'Add finish-to-start dependencies between a Rocketlane task and other tasks',
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
      description: 'Unique identifier of the task to add dependencies to',
    },
    dependencyTaskIds: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task IDs the task should depend on',
      items: { type: 'number' },
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}/add-dependencies`,
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
