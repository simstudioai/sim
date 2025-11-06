import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerGetTaskDetailsResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerGetTaskDetails')

export const getTaskDetailsTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerGetTaskDetailsResponse
> = {
  id: 'microsoft_planner_get_task_details',
  name: 'Get Microsoft Planner Task Details',
  description: 'Get detailed information about a task including checklist and references',
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
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the task',
    },
  },

  request: {
    url: (params) => {
      if (!params.taskId) {
        throw new Error('Task ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/tasks/${params.taskId}/details`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const taskDetails = await response.json()
    logger.info('Task details retrieved:', taskDetails)

    const result: MicrosoftPlannerGetTaskDetailsResponse = {
      success: true,
      output: {
        taskDetails,
        metadata: {
          taskId: taskDetails.id,
        },
      },
    }

    return result
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the task details were retrieved successfully',
    },
    taskDetails: {
      type: 'object',
      description: 'The task details including description, checklist, and references',
    },
    metadata: { type: 'object', description: 'Metadata including taskId' },
  },
}
