import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerReadResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerReadTask')

export const readTaskTool: ToolConfig<MicrosoftPlannerToolParams, MicrosoftPlannerReadResponse> = {
  id: 'microsoft_planner_read_task',
  name: 'Read Microsoft Planner Tasks',
  description:
    'Read tasks from Microsoft Planner - get all user tasks or all tasks from a specific plan',
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
      required: false,
      visibility: 'user-only',
      description: 'The ID of the plan to get tasks from (if not provided, gets all user tasks)',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The ID of the task to get',
    },
  },

  request: {
    url: (params) => {
      let finalUrl: string

      // If taskId is provided, get specific task
      if (params.taskId) {
        finalUrl = `https://graph.microsoft.com/v1.0/planner/tasks/${params.taskId}`
      }
      // Else if planId is provided, get tasks from plan
      else if (params.planId) {
        finalUrl = `https://graph.microsoft.com/v1.0/planner/plans/${params.planId}/tasks`
      }
      // Else get all user tasks
      else {
        finalUrl = 'https://graph.microsoft.com/v1.0/me/planner/tasks'
      }

      logger.info('Microsoft Planner URL:', finalUrl)
      return finalUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      logger.info('Access token present:', !!params.accessToken)
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    logger.info('Raw response data:', data)

    // Handle single task vs multiple tasks response format
    // Check if data is a single task object or has a 'value' property for multiple tasks
    const rawTasks = data.value ? data.value : Array.isArray(data) ? data : [data]

    // Filter tasks to only include useful fields
    const tasks = rawTasks.map((task: any) => ({
      id: task.id,
      title: task.title,
      planId: task.planId,
      bucketId: task.bucketId,
      percentComplete: task.percentComplete,
      priority: task.priority,
      dueDateTime: task.dueDateTime,
      createdDateTime: task.createdDateTime,
      completedDateTime: task.completedDateTime,
      hasDescription: task.hasDescription,
      assignments: task.assignments ? Object.keys(task.assignments) : [],
    }))

    const result: MicrosoftPlannerReadResponse = {
      success: true,
      output: {
        tasks,
        metadata: {
          planId: tasks.length > 0 ? tasks[0].planId : '',
          userId: data.value ? undefined : 'me',
          planUrl:
            tasks.length > 0
              ? `https://graph.microsoft.com/v1.0/planner/plans/${tasks[0].planId}`
              : undefined,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether tasks were retrieved successfully' },
    tasks: { type: 'array', description: 'Array of task objects with filtered properties' },
    metadata: { type: 'object', description: 'Metadata including planId, userId, and planUrl' },
  },
}
