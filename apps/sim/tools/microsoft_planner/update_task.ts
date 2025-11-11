import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdateTaskResponse,
  PlannerTask,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerUpdateTask')

export const updateTaskTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdateTaskResponse
> = {
  id: 'microsoft_planner_update_task',
  name: 'Update Microsoft Planner Task',
  description: 'Update a task in Microsoft Planner',
  version: '1.0',
  errorExtractor: 'nested-error-object',

  oauth: {
    required: true,
    provider: 'microsoft-planner',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Planner API',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the task to update',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the task to update (If-Match header)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The new title of the task',
    },
    bucketId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The bucket ID to move the task to',
    },
    dueDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The due date and time for the task (ISO 8601 format)',
    },
    startDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The start date and time for the task (ISO 8601 format)',
    },
    percentComplete: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The percentage of task completion (0-100)',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'The priority of the task (0-10)',
    },
    assigneeUserId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The user ID to assign the task to',
    },
  },

  request: {
    url: (params) => {
      if (!params.taskId) {
        throw new Error('Task ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/tasks/${params.taskId}`
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      if (!params.etag) {
        throw new Error('ETag is required for update operations')
      }

      let cleanedEtag = params.etag.trim()
      logger.info('ETag value received (raw):', { etag: params.etag, length: params.etag.length })

      while (cleanedEtag.startsWith('"') && cleanedEtag.endsWith('"')) {
        cleanedEtag = cleanedEtag.slice(1, -1)
        logger.info('Removed surrounding quotes:', cleanedEtag)
      }

      if (cleanedEtag.includes('\\"')) {
        cleanedEtag = cleanedEtag.replace(/\\"/g, '"')
        logger.info('Cleaned escaped quotes from etag:', {
          original: params.etag,
          cleaned: cleanedEtag,
        })
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        'If-Match': cleanedEtag,
      }
    },
    body: (params) => {
      const body: Partial<PlannerTask> = {}

      if (params.title !== undefined && params.title !== null && params.title !== '') {
        body.title = params.title
      }

      if (params.bucketId !== undefined && params.bucketId !== null && params.bucketId !== '') {
        body.bucketId = params.bucketId
      }

      if (
        params.dueDateTime !== undefined &&
        params.dueDateTime !== null &&
        params.dueDateTime !== ''
      ) {
        body.dueDateTime = params.dueDateTime
      }

      if (
        params.startDateTime !== undefined &&
        params.startDateTime !== null &&
        params.startDateTime !== ''
      ) {
        body.startDateTime = params.startDateTime
      }

      if (params.percentComplete !== undefined && params.percentComplete !== null) {
        body.percentComplete = params.percentComplete
      }

      if (params.priority !== undefined) {
        body.priority = Number(params.priority)
      }

      if (
        params.assigneeUserId !== undefined &&
        params.assigneeUserId !== null &&
        params.assigneeUserId !== ''
      ) {
        body.assignments = {
          [params.assigneeUserId]: {
            '@odata.type': 'microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        }
      }

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      logger.info('Updating task with body:', body)
      return body
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftPlannerToolParams) => {
    // Check if response has content before parsing
    const text = await response.text()
    if (!text || text.trim() === '') {
      logger.info('Update successful but no response body returned (204 No Content)')
      return {
        success: true,
        output: {
          message: 'Task updated successfully',
          task: {} as PlannerTask,
          taskId: params?.taskId || '',
          etag: params?.etag || '',
          metadata: {
            taskId: params?.taskId,
          },
        },
      }
    }

    const task = JSON.parse(text)
    logger.info('Updated task:', task)

    // Extract and clean the new etag for subsequent operations
    let newEtag = task['@odata.etag']
    if (newEtag && typeof newEtag === 'string' && newEtag.includes('\\"')) {
      newEtag = newEtag.replace(/\\"/g, '"')
    }

    const result: MicrosoftPlannerUpdateTaskResponse = {
      success: true,
      output: {
        message: 'Task updated successfully',
        task,
        taskId: task.id,
        etag: newEtag,
        metadata: {
          taskId: task.id,
          planId: task.planId,
          taskUrl: `https://graph.microsoft.com/v1.0/planner/tasks/${task.id}`,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the task was updated successfully' },
    message: { type: 'string', description: 'Success message when task is updated' },
    task: { type: 'object', description: 'The updated task object with all properties' },
    taskId: { type: 'string', description: 'ID of the updated task' },
    etag: {
      type: 'string',
      description: 'New ETag after update - use this for subsequent operations',
    },
    metadata: { type: 'object', description: 'Metadata including taskId, planId, and taskUrl' },
  },
}
