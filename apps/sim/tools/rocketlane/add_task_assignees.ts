import {
  buildTaskMembers,
  mapTask,
  ROCKETLANE_API_BASE,
  type RocketlaneTaskAssigneesParams,
  type RocketlaneTaskResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TASK_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneAddTaskAssigneesTool: ToolConfig<
  RocketlaneTaskAssigneesParams,
  RocketlaneTaskResponse
> = {
  id: 'rocketlane_add_task_assignees',
  name: 'Rocketlane Add Task Assignees',
  description: 'Add members as assignees to a Rocketlane task',
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
      description: 'Unique identifier of the task to add assignees to',
    },
    memberUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of members to add as assignees',
      items: { type: 'number' },
    },
    memberEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email addresses of members to add as assignees',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}/add-assignees`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      members: buildTaskMembers(params.memberUserIds, params.memberEmailIds),
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
      description: 'The task with its updated assignees',
      properties: TASK_OUTPUT_PROPERTIES,
    },
  },
}
