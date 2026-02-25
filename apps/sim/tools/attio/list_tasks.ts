import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioListTasksParams, AttioListTasksResponse } from './types'
import { TASK_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioListTasks')

export const attioListTasksTool: ToolConfig<AttioListTasksParams, AttioListTasksResponse> = {
  id: 'attio_list_tasks',
  name: 'Attio List Tasks',
  description: 'List tasks in Attio, optionally filtered by record, assignee, or completion status',
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
    linkedObject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object type slug to filter tasks by (requires linkedRecordId)',
    },
    linkedRecordId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Record ID to filter tasks by (requires linkedObject)',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignee email or member ID to filter by',
    },
    isCompleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by completion status',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: created_at:asc or created_at:desc',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tasks to return (default 500)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tasks to skip for pagination',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.linkedObject) searchParams.set('linked_object', params.linkedObject)
      if (params.linkedRecordId) searchParams.set('linked_record_id', params.linkedRecordId)
      if (params.assignee) searchParams.set('assignee', params.assignee)
      if (params.isCompleted != null) {
        searchParams.set('is_completed', String(params.isCompleted))
      }
      if (params.sort) searchParams.set('sort', params.sort)
      if (params.limit != null) searchParams.set('limit', String(params.limit))
      if (params.offset != null) searchParams.set('offset', String(params.offset))
      const qs = searchParams.toString()
      return `https://api.attio.com/v2/tasks${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to list tasks')
    }
    const tasks = (data.data ?? []).map((task: Record<string, unknown>) => {
      const taskId = task.id as { task_id?: string } | undefined
      const linkedRecords =
        (
          task.linked_records as Array<{ target_object_id?: string; target_record_id?: string }>
        )?.map((r) => ({
          targetObjectId: r.target_object_id ?? null,
          targetRecordId: r.target_record_id ?? null,
        })) ?? []
      const assignees =
        (
          task.assignees as Array<{
            referenced_actor_type?: string
            referenced_actor_id?: string
          }>
        )?.map((a) => ({
          type: a.referenced_actor_type ?? null,
          id: a.referenced_actor_id ?? null,
        })) ?? []
      return {
        taskId: taskId?.task_id ?? null,
        content: (task.content_plaintext as string) ?? null,
        deadlineAt: (task.deadline_at as string) ?? null,
        isCompleted: (task.is_completed as boolean) ?? false,
        linkedRecords,
        assignees,
        createdByActor: task.created_by_actor ?? null,
        createdAt: (task.created_at as string) ?? null,
      }
    })
    return {
      success: true,
      output: {
        tasks,
        count: tasks.length,
      },
    }
  },

  outputs: {
    tasks: {
      type: 'array',
      description: 'Array of tasks',
      items: {
        type: 'object',
        properties: TASK_OUTPUT_PROPERTIES,
      },
    },
    count: { type: 'number', description: 'Number of tasks returned' },
  },
}
