import { createLogger } from '@sim/logger'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdatePlanDetailsResponse,
  PlannerPlanDetails,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerUpdatePlanDetails')

export const updatePlanDetailsTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdatePlanDetailsResponse
> = {
  id: 'microsoft_planner_update_plan_details',
  name: 'Update Microsoft Planner Plan Details',
  description:
    "Update a plan's category (color label) descriptions and shared-with user list in Microsoft Planner",
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
      description: 'The ID of the plan (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the plan details to update (If-Match header)',
    },
    categoryDescriptions: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description:
        'Category label names as a JSON object, e.g. {"category1": "Blocked", "category2": "At Risk"}. Set a value to null to clear a label.',
    },
    sharedWith: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description:
        'User IDs to share the plan with as a JSON object, e.g. {"<user-id>": true}. Set a value to false to unshare.',
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
      const body: Record<string, any> = {}

      if (params.categoryDescriptions) {
        try {
          body.categoryDescriptions =
            typeof params.categoryDescriptions === 'string'
              ? JSON.parse(params.categoryDescriptions)
              : params.categoryDescriptions
        } catch {
          throw new Error('categoryDescriptions must be valid JSON')
        }
      }

      if (params.sharedWith) {
        try {
          body.sharedWith =
            typeof params.sharedWith === 'string'
              ? JSON.parse(params.sharedWith)
              : params.sharedWith
        } catch {
          throw new Error('sharedWith must be valid JSON')
        }
      }

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      logger.info('Updating plan details with body:', body)
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
          planDetails: {} as PlannerPlanDetails,
          metadata: {
            planId: params?.planId?.trim(),
          },
        },
      }
    }

    const planDetails = JSON.parse(text)
    logger.info('Updated plan details:', planDetails)

    const result: MicrosoftPlannerUpdatePlanDetailsResponse = {
      success: true,
      output: {
        planDetails,
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
      description: 'Whether the plan details were updated successfully',
    },
    planDetails: {
      type: 'object',
      description: 'The updated plan details object with categoryDescriptions and sharedWith',
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
