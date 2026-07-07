import { createLogger } from '@sim/logger'
import { ErrorExtractorId } from '@/tools/error-extractors'
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
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

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
      visibility: 'user-or-llm',
      description: 'The ID of the task to update (e.g., "pbT5K2OVkkO1M7r5bfsJ6JgAGD5m")',
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
      visibility: 'user-or-llm',
      description: 'The new title of the task (e.g., "Review quarterly report")',
    },
    bucketId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The bucket ID to move the task to (e.g., "hsOf2dhOJkC6Fey9VjDg1JgAC9Rq")',
    },
    dueDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The due date and time for the task in ISO 8601 format (e.g., "2025-03-15T17:00:00Z")',
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
      visibility: 'user-or-llm',
      description:
        'The user ID to assign the task to (e.g., "e82f74c3-4d8a-4b5c-9f1e-2a6b8c9d0e3f")',
    },
    appliedCategories: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated category labels to apply to the task, e.g. "category1,category3" (up to category1-category25, plan-defined color labels)',
    },
  },

  request: {
    url: (params) => {
      const taskId = params.taskId?.trim()
      if (!taskId) {
        throw new Error('Task ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/tasks/${taskId}`
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
        Prefer: 'return=representation',
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

      if (params.priority !== undefined && params.priority !== null) {
        body.priority = Number(params.priority)
      }

      if (
        params.assigneeUserId !== undefined &&
        params.assigneeUserId !== null &&
        params.assigneeUserId !== ''
      ) {
        body.assignments = {
          [params.assigneeUserId]: {
            '@odata.type': '#microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        }
      }

      if (params.appliedCategories?.trim()) {
        const categories = params.appliedCategories
          .split(',')
          .map((category) => category.trim())
          .filter(Boolean)

        if (categories.length > 0) {
          body.appliedCategories = Object.fromEntries(
            categories.map((category) =>
              category.startsWith('-') ? [category.slice(1), false] : [category, true]
            )
          )
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
    // Check if response has content before parsing (Prefer: return=representation requests a
    // body, but the service may still return 204 No Content for some tenants/requests)
    const text = await response.text()
    if (!text || text.trim() === '') {
      logger.info('Update successful but no response body returned (204 No Content)')
      return {
        success: true,
        output: {
          // Graph returned no body, so the etag sent in this request is now stale (the
          // update changed it) and the actual new value is unknown. Returning it here would
          // let a chained update silently reuse a stale If-Match and fail with 412 — leave
          // it empty so callers re-fetch the task before their next update.
          message: 'Task updated successfully (re-fetch the task to get its current etag)',
          task: {} as PlannerTask,
          taskId: params?.taskId?.trim() || '',
          etag: '',
          metadata: {
            taskId: params?.taskId?.trim(),
          },
        },
      }
    }

    const task = JSON.parse(text)
    logger.info('Updated task:', task)

    // Extract and clean the new etag for subsequent operations
    let newEtag = task['@odata.etag'] ?? null
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
      optional: true,
    },
    metadata: {
      type: 'object',
      description: 'Metadata including taskId, planId, and taskUrl',
      properties: {
        taskId: { type: 'string', description: 'Updated task ID' },
        planId: { type: 'string', description: 'Parent plan ID' },
        taskUrl: { type: 'string', description: 'Microsoft Graph API URL for the task' },
      },
    },
  },
}
