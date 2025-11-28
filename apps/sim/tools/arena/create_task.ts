import { startOfDayTimestamp } from '@/lib/arena-utils/arena-utils'
import type {
  ArenaCreateTaskParams,
  ArenaCreateTaskResponse,
} from '@/tools/arena_task_manager/types'
import type { ToolConfig } from '@/tools/types'

export const createTask: ToolConfig<ArenaCreateTaskParams, ArenaCreateTaskResponse> = {
  id: 'arena_create_task',
  name: 'Arena Create Task',
  description: 'Create a task in Arena.',
  version: '1.0.0',

  params: {
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Operation to perform (e.g., create)',
    },
    'task-name': {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the task',
    },
    'task-description': {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Detailed description of the task',
    },
    'task-client': {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Client associated with the task',
    },
    'task-project': {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project under which the task belongs',
    },
    'task-group': {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional task group with id and name',
    },
    'task-task': {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional parent task reference',
    },
    'task-assignee': {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User ID of the assignee',
    },
  },

  request: {
    url: (params: ArenaCreateTaskParams) => {
      const url = `/api/tools/arena/tasks`
      return url
    },
    method: 'POST',
    headers: (params: ArenaCreateTaskParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
    },
    body: (params: ArenaCreateTaskParams) => {
      const today = new Date()
      const nextWeekDay = new Date()
      nextWeekDay.setDate(today.getDate() + 7)
      const isTask = params.operation === 'arena_create_task'

      // ✅ Validation checks
      if (!params._context?.workflowId) throw new Error('Missing required field: workflowId')
      if (!params['task-name']) throw new Error('Missing required field: Task Name')
      if (!params['task-description']) throw new Error('Missing required field: Task Description')
      if (!params['task-client']?.clientId) throw new Error('Missing required field: Task Client')
      if (!params['task-project']) throw new Error('Missing required field: Project')
      if (!params['task-assignee']) throw new Error('Missing required field: Assignee')

      if (isTask) {
        if (!params['task-group']?.id) throw new Error('Missing required field: Task Group')
      } else {
        if (!params['task-task']) throw new Error('Missing required field: Task')
      }

      const body: Record<string, any> = {
        workflowId: params._context.workflowId,
        name: params['task-name'],
        taskHtmlDescription: params['task-description'],
        plannedStartDate: startOfDayTimestamp(today),
        plannedEndDate: startOfDayTimestamp(nextWeekDay),
        taskType: isTask ? 'MILESTONE' : 'SHOW-ON-TIMELINE',
        clientId: params['task-client']?.clientId,
        projectId: params['task-project'],
        assignedToId: params['task-assignee'],
      }

      if (isTask) {
        body.epicId = params['task-group']?.id
        body.epicName = params['task-group']?.name
      } else {
        body.deliverableId = params['task-task']
      }

      return body
    },
  },

  transformResponse: async (
    response: Response,
    params?: ArenaCreateTaskParams
  ): Promise<ArenaCreateTaskResponse> => {
    const data = await response.json()
    return {
      success: true,
      output: {
        success: true,
        output: data,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Indicates if transform was successful' },
    output: { type: 'object', description: 'Output from Arena' },
  },
}
