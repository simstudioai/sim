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
  description: 'Read tasks from Microsoft Planner - get all user tasks, all tasks in a plan, or a specific task',
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
      visibility: 'user-or-llm',
      description: 'The ID of the plan to get tasks from (if not provided, gets all user tasks)',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of a specific task to retrieve',
    },
  },
  request: {
    url: (params) => {
      const finalUrl = params.taskId 
        ? `https://graph.microsoft.com/v1.0/planner/tasks/${params.taskId}`
        : 'https://graph.microsoft.com/v1.0/me/planner/tasks'
      
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
  transformResponse: async (response: Response, params) => {
    logger.info('Raw response URL:', response.url)
    logger.info('Raw response status:', response.status)
    
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({ error: response.statusText }))
      const errorText =
        errorJson.error && typeof errorJson.error === 'object'
          ? errorJson.error.message || JSON.stringify(errorJson.error)
          : errorJson.error || response.statusText
      throw new Error(`Failed to read Microsoft Planner tasks: ${errorText}`)
    }

    const data = await response.json()
    logger.info('Raw response data:', data)
    logger.info('Retrieved task data:', data)

    let result: MicrosoftPlannerReadResponse

    // If we got a specific task
    if (params?.taskId) {
      result = {
        success: true,
        output: {
          task: data,
          metadata: {
            taskId: data.id,
            planId: data.planId,
            taskUrl: `https://graph.microsoft.com/v1.0/planner/tasks/${data.id}`,
          },
        },
      }
    } else {
      // If we got multiple tasks (either from plan or user tasks)
      const tasks = data.value || []
      result = {
        success: true,
        output: {
          tasks,
          metadata: {
            planId: params?.planId,
            userId: params?.planId ? undefined : 'me',
            planUrl: params?.planId ? `https://graph.microsoft.com/v1.0/planner/plans/${params.planId}` : undefined,
          },
        },
      }
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

    return 'An error occurred while reading Microsoft Planner tasks'
  },
}
