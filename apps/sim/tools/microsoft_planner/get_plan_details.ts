import { createLogger } from '@sim/logger'
import type {
  MicrosoftPlannerGetPlanDetailsResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerGetPlanDetails')

export const getPlanDetailsTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerGetPlanDetailsResponse
> = {
  id: 'microsoft_planner_get_plan_details',
  name: 'Get Microsoft Planner Plan Details',
  description: 'Get detailed information about a plan including category descriptions and sharing',
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
      description: 'The ID of the plan (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
  },

  request: {
    url: (params) => {
      const planId = params.planId?.trim()
      if (!planId) {
        throw new Error('Plan ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/plans/${planId}/details`
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
    const planDetails = await response.json()
    logger.info('Plan details retrieved:', planDetails)

    const etag = planDetails['@odata.etag'] || ''

    const result: MicrosoftPlannerGetPlanDetailsResponse = {
      success: true,
      output: {
        planDetails,
        etag,
        metadata: {
          planId: planDetails.id,
        },
      },
    }

    return result
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the plan details were retrieved successfully',
    },
    planDetails: {
      type: 'object',
      description: 'The plan details including categoryDescriptions and sharedWith',
    },
    etag: {
      type: 'string',
      description: 'The ETag value for this plan details resource',
    },
    metadata: {
      type: 'object',
      description: 'Metadata including planId',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
      },
    },
  },
}
