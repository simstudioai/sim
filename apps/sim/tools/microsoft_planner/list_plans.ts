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
  description: 'List all plans in a Microsoft 365 group',
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
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the Microsoft 365 group',
    },
  },

  request: {
    url: (params) => {
      if (!params.groupId) {
        throw new Error('Group ID is required')
      }
      return `https://graph.microsoft.com/v1.0/groups/${params.groupId}/planner/plans`
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
          groupId: plans.length > 0 ? plans[0].container?.containerId : undefined,
          count: plans.length,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether plans were retrieved successfully' },
    plans: { type: 'array', description: 'Array of plan objects' },
    metadata: { type: 'object', description: 'Metadata including groupId and count' },
  },
}
