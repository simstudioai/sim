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

export const rocketlaneRemoveTaskAssigneesTool: ToolConfig<
  RocketlaneTaskAssigneesParams,
  RocketlaneTaskResponse
> = {
  id: 'rocketlane_remove_task_assignees',
  name: 'Rocketlane Remove Task Assignees',
  description: 'Remove assignees from a Rocketlane task',
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
      description: 'Unique identifier of the task to remove assignees from',
    },
    memberUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of members to remove from the assignees',
      items: { type: 'number' },
    },
    memberEmailIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email addresses of members to remove from the assignees',
      items: { type: 'string' },
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}/remove-assignees`,
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
