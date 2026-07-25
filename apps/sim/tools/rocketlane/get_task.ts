import {
  mapTask,
  ROCKETLANE_API_BASE,
  type RocketlaneGetTaskParams,
  type RocketlaneTaskResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TASK_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneGetTaskTool: ToolConfig<RocketlaneGetTaskParams, RocketlaneTaskResponse> = {
  id: 'rocketlane_get_task',
  name: 'Rocketlane Get Task',
  description: 'Retrieve detailed information about a Rocketlane task by its unique identifier',
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
      description: 'Unique identifier of the task to retrieve',
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Extra fields to include in the response (startDateActual, dueDateActual, type, phase, assignees, followers, dependencies, billable, csatEnabled, priority, timeEntryCategory, financialsBudget, taskPrivateNote, parent, externalReferenceId)',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether all fields should be returned in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}`
      )
      if (params.includeFields && params.includeFields.length > 0) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields !== undefined) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
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
      description: 'The requested task',
      properties: TASK_OUTPUT_PROPERTIES,
    },
  },
}
