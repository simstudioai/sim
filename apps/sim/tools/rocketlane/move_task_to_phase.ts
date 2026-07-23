import {
  mapTask,
  ROCKETLANE_API_BASE,
  type RocketlaneMoveTaskToPhaseParams,
  type RocketlaneTaskResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TASK_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneMoveTaskToPhaseTool: ToolConfig<
  RocketlaneMoveTaskToPhaseParams,
  RocketlaneTaskResponse
> = {
  id: 'rocketlane_move_task_to_phase',
  name: 'Rocketlane Move Task To Phase',
  description: 'Move a Rocketlane task to a given phase, associating the task with that phase',
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
      description: 'Unique identifier of the task to move',
    },
    phaseId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the phase to move the task to',
    },
  },

  request: {
    url: (params) =>
      `${ROCKETLANE_API_BASE}/tasks/${encodeURIComponent(String(params.taskId))}/move-phase`,
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => ({
      phase: { phaseId: params.phaseId },
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
      description: 'The task with its updated phase',
      properties: TASK_OUTPUT_PROPERTIES,
    },
  },
}
