import { createLogger } from '@sim/logger'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdatePlanResponse,
  PlannerPlan,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerUpdatePlan')

export const updatePlanTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdatePlanResponse
> = {
  id: 'microsoft_planner_update_plan',
  name: 'Update Microsoft Planner Plan',
  description: 'Rename a Microsoft Planner plan',
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
    planId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the plan to update (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the plan to update (If-Match header)',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The new title of the plan',
    },
  },

  request: {
    url: (params) => {
      const planId = params.planId?.trim()
      if (!planId) {
        throw new Error('Plan ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/plans/${planId}`
    },
    method: 'PATCH',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      if (!params.etag) {
        throw new Error('ETag is required for update operations')
      }

      let cleanedEtag = params.etag.trim()

      while (cleanedEtag.startsWith('"') && cleanedEtag.endsWith('"')) {
        cleanedEtag = cleanedEtag.slice(1, -1)
      }

      if (cleanedEtag.includes('\\"')) {
        cleanedEtag = cleanedEtag.replace(/\\"/g, '"')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        'If-Match': cleanedEtag,
      }
    },
    body: (params) => {
      if (!params.title?.trim()) {
        throw new Error('Plan title is required')
      }

      const body = { title: params.title.trim() }

      logger.info('Updating plan with body:', body)
      return body
    },
  },

  transformResponse: async (response: Response, params?: MicrosoftPlannerToolParams) => {
    // Prefer: return=representation requests a body, but the service may still return
    // 204 No Content for some tenants/requests
    const text = await response.text()
    if (!text || text.trim() === '') {
      logger.info('Update successful but no response body returned (204 No Content)')
      return {
        success: true,
        output: {
          plan: {} as PlannerPlan,
          metadata: {
            planId: params?.planId?.trim(),
          },
        },
      }
    }

    const plan = JSON.parse(text)
    logger.info('Updated plan:', plan)

    const result: MicrosoftPlannerUpdatePlanResponse = {
      success: true,
      output: {
        plan,
        metadata: {
          planId: plan.id,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the plan was updated successfully' },
    plan: { type: 'object', description: 'The updated plan object with all properties' },
    metadata: {
      type: 'object',
      description: 'Metadata including planId',
      properties: {
        planId: { type: 'string', description: 'Updated plan ID' },
      },
    },
  },
}
