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

  transformResponse: async (response: Response) => {
    const task = await response.json()
    logger.info('Created task:', task)

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

  outputs: {
    success: { type: 'boolean', description: 'Whether the task was created successfully' },
    task: { type: 'object', description: 'The created task object with all properties' },
    metadata: { type: 'object', description: 'Metadata including planId, taskId, and taskUrl' },
  },
}
