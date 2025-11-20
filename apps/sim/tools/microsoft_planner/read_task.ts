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
        // Validate and clean task ID
        const cleanTaskId = params.taskId.trim()
        if (!cleanTaskId) {
          throw new Error('Task ID cannot be empty')
        }

        // Log the task ID for debugging
        logger.info('Fetching task with ID:', cleanTaskId)
        logger.info('Task ID length:', cleanTaskId.length)
        logger.info('Task ID has special chars:', /[^a-zA-Z0-9_-]/.test(cleanTaskId))

        finalUrl = `https://graph.microsoft.com/v1.0/planner/tasks/${cleanTaskId}`
      }
      // Else if planId is provided, get tasks from plan
      else if (params.planId) {
        const cleanPlanId = params.planId.trim()
        if (!cleanPlanId) {
          throw new Error('Plan ID cannot be empty')
        }
        logger.info('Fetching tasks for plan:', cleanPlanId)
        finalUrl = `https://graph.microsoft.com/v1.0/planner/plans/${cleanPlanId}/tasks`
      }
      // Else get all user tasks
      else {
        logger.info('Fetching all user tasks')
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
      logger.info('Access token length:', params.accessToken.length)

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    logger.info('Raw response data:', data)

    const rawTasks = data.value ? data.value : Array.isArray(data) ? data : [data]

    const tasks = rawTasks.map((task: any) => {
      let etagValue = task['@odata.etag']
      logger.info('ETag value extracted (raw):', {
        raw: etagValue,
        type: typeof etagValue,
        length: etagValue?.length,
      })

      if (etagValue && typeof etagValue === 'string') {
        if (etagValue.includes('\\"')) {
          etagValue = etagValue.replace(/\\"/g, '"')
          logger.info('Unescaped etag quotes:', { cleaned: etagValue })
        }
      }

      return {
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
        etag: etagValue,
      }
    })

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

    logger.info('Successfully transformed response with', tasks.length, 'tasks')
    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether tasks were retrieved successfully' },
    tasks: { type: 'array', description: 'Array of task objects with filtered properties' },
    metadata: { type: 'object', description: 'Metadata including planId, userId, and planUrl' },
  },
}
