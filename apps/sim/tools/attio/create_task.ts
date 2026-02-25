import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioCreateTaskParams, AttioCreateTaskResponse } from './types'
import { TASK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioCreateTask')

export const attioCreateTaskTool: ToolConfig<AttioCreateTaskParams, AttioCreateTaskResponse> = {
  id: 'attio_create_task',
  name: 'Attio Create Task',
  description: 'Create a task in Attio',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The task content (max 2000 characters)',
    },
    deadlineAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Deadline in ISO 8601 format (e.g. 2024-12-01T15:00:00.000Z)',
    },
    isCompleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the task is completed (default false)',
    },
    linkedRecords: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of linked records (e.g. [{"target_object":"people","target_record_id":"..."}])',
    },
    assignees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of assignees (e.g. [{"referenced_actor_type":"workspace-member","referenced_actor_id":"..."}])',
    },
  },

  request: {
    url: 'https://api.attio.com/v2/tasks',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let linkedRecords: unknown[] = []
      let assignees: unknown[] = []
      try {
        if (params.linkedRecords) {
          linkedRecords =
            typeof params.linkedRecords === 'string'
              ? JSON.parse(params.linkedRecords)
              : params.linkedRecords
        }
      } catch {
        linkedRecords = []
      }
      try {
        if (params.assignees) {
          assignees =
            typeof params.assignees === 'string' ? JSON.parse(params.assignees) : params.assignees
        }
      } catch {
        assignees = []
      }
      return {
        data: {
          content: params.content,
          format: 'plaintext',
          deadline_at: params.deadlineAt || null,
          is_completed: params.isCompleted ?? false,
          linked_records: linkedRecords,
          assignees,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to create task')
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
