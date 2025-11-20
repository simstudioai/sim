import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerListPlansResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerListPlans')

export const listPlansTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerListPlansResponse
> = {
  id: 'microsoft_planner_list_plans',
  name: 'List Microsoft Planner Plans',
  description: 'List all plans shared with the current user',
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
  },

  request: {
    url: () => {
      return 'https://graph.microsoft.com/v1.0/me/planner/plans'
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
    const data = await response.json()
    logger.info('List plans response:', data)

    const plans = data.value || []

    const result: MicrosoftPlannerListPlansResponse = {
      success: true,
      output: {
        plans,
        metadata: {
          count: plans.length,
          userId: 'me',
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether plans were retrieved successfully' },
    plans: { type: 'array', description: 'Array of plan objects shared with the current user' },
    metadata: { type: 'object', description: 'Metadata including userId and count' },
  },
}
