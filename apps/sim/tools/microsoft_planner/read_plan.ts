import { createLogger } from '@sim/logger'
import type {
  MicrosoftPlannerReadPlanResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerReadPlan')

export const readPlanTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerReadPlanResponse
> = {
  id: 'microsoft_planner_read_plan',
  name: 'Read Microsoft Planner Plan',
  description: 'Get details of a specific Microsoft Planner plan',
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
      description: 'The ID of the plan to retrieve (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
  },

  request: {
    url: (params) => {
      if (!params.planId) {
        throw new Error('Plan ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/plans/${params.planId}`
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
    const plan = await response.json()
    logger.info('Read plan response:', plan)

    const result: MicrosoftPlannerReadPlanResponse = {
      success: true,
      output: {
        plan,
        metadata: {
          planId: plan.id,
          planUrl: `https://graph.microsoft.com/v1.0/planner/plans/${plan.id}`,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the plan was retrieved successfully' },
    plan: { type: 'object', description: 'The plan object with all properties' },
    metadata: {
      type: 'object',
      description: 'Metadata including planId and planUrl',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        planUrl: { type: 'string', description: 'Microsoft Graph API URL for the plan' },
      },
    },
  },
}
