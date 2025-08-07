import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerCreateResponse,
  MicrosoftPlannerToolParams,
  PlannerTask,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerCreateTask')

export const createTaskTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerCreateResponse
> = {
  id: 'microsoft_planner_create_task',
  name: 'Create Microsoft Planner Task',
  description: 'Create a new task in Microsoft Planner',
  version: '1.0',
  oauth: {
    required: true,
    provider: 'microsoft-planner',
    additionalScopes: [],
  },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Microsoft Planner API',
    },
    planId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the plan where the task will be created',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The title of the task',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The description of the task',
    },
    dueDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The due date and time for the task (ISO 8601 format)',
    },
    assigneeUserId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The user ID to assign the task to',
    },
    bucketId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The bucket ID to place the task in',
    },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the task was created successfully' },
    task: { type: 'object', description: 'The created task object with all properties' },
    metadata: { type: 'object', description: 'Metadata including planId, taskId, and taskUrl' },
  },
  request: {
    url: () => 'https://graph.microsoft.com/v1.0/planner/tasks',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      if (!params.planId) {
        throw new Error('Plan ID is required')
      }
      if (!params.title) {
        throw new Error('Task title is required')
      }

      const body: PlannerTask = {
        planId: params.planId,
        title: params.title,
      }

      if (params.bucketId) {
        body.bucketId = params.bucketId
      }

      if (params.dueDateTime) {
        body.dueDateTime = params.dueDateTime
      }

      if (params.assigneeUserId) {
        body.assignments = {
          [params.assigneeUserId]: {
            '@odata.type': 'microsoft.graph.plannerAssignment',
            orderHint: ' !',
          },
        }
      }

      logger.info('Creating task with body:', body)
      return body
    },
  },
  transformResponse: async (response: Response, params) => {
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({ error: response.statusText }))
      const errorText =
        errorJson.error && typeof errorJson.error === 'object'
          ? errorJson.error.message || JSON.stringify(errorJson.error)
          : errorJson.error || response.statusText
      throw new Error(`Failed to create Microsoft Planner task: ${errorText}`)
    }

    const task = await response.json()
    logger.info('Created task:', task)

    // If description was provided, update the task details
    if (params?.description && task.id) {
      try {
        const detailsUrl = `https://graph.microsoft.com/v1.0/planner/tasks/${task.id}/details`
        // Get task details to get the ETag
        const getDetailsResponse = await fetch(detailsUrl, {
          headers: { Authorization: `Bearer ${params.accessToken}` },
        })
        const etag = getDetailsResponse.headers.get('ETag')

        // Then update with correct ETag
        const detailsResponse = await fetch(detailsUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json',
            'If-Match': etag || '*', // Use actual ETag or '*' if not available
          },
          body: JSON.stringify({
            description: params.description,
          }),
        })

        if (detailsResponse.ok) {
          const details = await detailsResponse.json()
          task.details = details
        }
      } catch (error) {
        logger.warn('Failed to update task description:', error)
      }
    }

    const result: MicrosoftPlannerCreateResponse = {
      success: true,
      output: {
        task,
        metadata: {
          planId: task.planId,
          taskId: task.id,
          taskUrl: `https://graph.microsoft.com/v1.0/planner/tasks/${task.id}`,
        },
      },
    }

    return result
  },
  transformError: (error) => {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'object' && error !== null) {
      if (error.error) {
        if (typeof error.error === 'string') {
          return error.error
        }
        if (typeof error.error === 'object' && error.error.message) {
          return error.error.message
        }
        return JSON.stringify(error.error)
      }

      if (error.message) {
        return error.message
      }

      try {
        return `Microsoft Planner API error: ${JSON.stringify(error)}`
      } catch (_e) {
        return 'Microsoft Planner API error: Unable to parse error details'
      }
    }

    return 'An error occurred while creating the Microsoft Planner task'
  },
}
