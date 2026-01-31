import { createLogger } from '@sim/logger'
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
      visibility: 'user-or-llm',
      description:
        'The ID of the plan where the task will be created (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the task (e.g., "Review quarterly report")',
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
      visibility: 'user-or-llm',
      description:
        'The due date and time for the task in ISO 8601 format (e.g., "2025-03-15T17:00:00Z")',
    },
    assigneeUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The user ID to assign the task to (e.g., "e82f74c3-4d8a-4b5c-9f1e-2a6b8c9d0e3f")',
    },
    bucketId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The bucket ID to place the task in (e.g., "hsOf2dhOJkC6Fey9VjDg1JgAC9Rq")',
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
    metadata: {
      type: 'object',
      description: 'Metadata including planId, taskId, and taskUrl',
      properties: {
        planId: { type: 'string', description: 'Parent plan ID' },
        taskId: { type: 'string', description: 'Created task ID' },
        taskUrl: { type: 'string', description: 'Microsoft Graph API URL for the task' },
      },
    },
  },
}
