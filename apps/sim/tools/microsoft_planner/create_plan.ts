import { createLogger } from '@sim/logger'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftPlannerCreatePlanResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerCreatePlan')

export const createPlanTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerCreatePlanResponse
> = {
  id: 'microsoft_planner_create_plan',
  name: 'Create Microsoft Planner Plan',
  description: 'Create a new Microsoft Planner plan owned by a Microsoft 365 group',
  version: '1.0',
  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

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
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ID of the Microsoft 365 group that will own the plan (e.g., "ebf3b108-5234-4e22-b93d-656d7dae5874"). The current user must be a member of this group.',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the plan',
    },
  },

  request: {
    url: () => 'https://graph.microsoft.com/v1.0/planner/plans',
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
      const groupId = params.groupId?.trim()
      if (!groupId) {
        throw new Error('Microsoft 365 group ID is required')
      }
      if (!params.title) {
        throw new Error('Plan title is required')
      }

      const body = {
        container: {
          url: `https://graph.microsoft.com/v1.0/groups/${groupId}`,
        },
        title: params.title,
      }

      logger.info('Creating plan with body:', body)
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const plan = await response.json()
    logger.info('Created plan:', plan)

    const result: MicrosoftPlannerCreatePlanResponse = {
      success: true,
      output: {
        plan,
        metadata: {
          planId: plan.id,
          groupId: plan.container?.containerId,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the plan was created successfully' },
    plan: { type: 'object', description: 'The created plan object with all properties' },
    metadata: {
      type: 'object',
      description: 'Metadata including planId and groupId',
      properties: {
        planId: { type: 'string', description: 'Created plan ID' },
        groupId: { type: 'string', description: 'Owning Microsoft 365 group ID' },
      },
    },
  },
}
