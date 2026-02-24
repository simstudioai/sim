import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioUpdateTaskParams, AttioUpdateTaskResponse } from './types'
import { TASK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioUpdateTask')

export const attioUpdateTaskTool: ToolConfig<AttioUpdateTaskParams, AttioUpdateTaskResponse> = {
  id: 'attio_update_task',
  name: 'Attio Update Task',
  description: 'Update a task in Attio (deadline, completion status, linked records, assignees)',
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
      description: 'The ID of the task to update',
    },
    deadlineAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New deadline in ISO 8601 format',
    },
    isCompleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the task is completed',
    },
    linkedRecords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of linked records',
    },
    assignees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of assignees',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/tasks/${params.taskId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const data: Record<string, unknown> = {}
      if (params.deadlineAt != null) data.deadline_at = params.deadlineAt || null
      if (params.isCompleted != null) data.is_completed = params.isCompleted
      if (params.linkedRecords) {
        try {
          data.linked_records =
            typeof params.linkedRecords === 'string'
              ? JSON.parse(params.linkedRecords)
              : params.linkedRecords
        } catch {
          data.linked_records = []
        }
      }
      if (params.assignees) {
        try {
          data.assignees =
            typeof params.assignees === 'string' ? JSON.parse(params.assignees) : params.assignees
        } catch {
          data.assignees = []
        }
      }
      return { data }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to update task')
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
