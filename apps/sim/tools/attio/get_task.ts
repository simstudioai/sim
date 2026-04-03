import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioGetTaskParams, AttioGetTaskResponse } from './types'
import { TASK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioGetTask')

export const attioGetTaskTool: ToolConfig<AttioGetTaskParams, AttioGetTaskResponse> = {
  id: 'attio_get_task',
  name: 'Attio Get Task',
  description: 'Get a single task by ID from Attio',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the task to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/tasks/${params.taskId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to get task')
    }
    const task = data.data
    const linkedRecords = (task.linked_records ?? []).map(
      (r: { target_object_id?: string; target_record_id?: string }) => ({
        targetObjectId: r.target_object_id ?? null,
        targetRecordId: r.target_record_id ?? null,
      })
    )
    const assignees = (task.assignees ?? []).map(
      (a: { referenced_actor_type?: string; referenced_actor_id?: string }) => ({
        type: a.referenced_actor_type ?? null,
        id: a.referenced_actor_id ?? null,
      })
    )
    return {
      success: true,
      output: {
        taskId: task.id?.task_id ?? null,
        content: task.content_plaintext ?? null,
        deadlineAt: task.deadline_at ?? null,
        isCompleted: task.is_completed ?? false,
        linkedRecords,
        assignees,
        createdByActor: task.created_by_actor ?? null,
        createdAt: task.created_at ?? null,
      },
    }
  },

  outputs: TASK_OUTPUT_PROPERTIES,
}
