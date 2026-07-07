import { createLogger } from '@sim/logger'
import type {
  MicrosoftPlannerDeletePlanResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerDeletePlan')

export const deletePlanTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerDeletePlanResponse
> = {
  id: 'microsoft_planner_delete_plan',
  name: 'Delete Microsoft Planner Plan',
  description: 'Delete a Microsoft Planner plan',
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
      description: 'The ID of the plan to delete (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the plan to delete (If-Match header)',
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
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      if (!params.etag) {
        throw new Error('ETag is required for delete operations')
      }

      let cleanedEtag = params.etag.trim()

      while (cleanedEtag.startsWith('"') && cleanedEtag.endsWith('"')) {
        cleanedEtag = cleanedEtag.slice(1, -1)
        logger.info('Removed surrounding quotes:', cleanedEtag)
      }

      if (cleanedEtag.includes('\\"')) {
        cleanedEtag = cleanedEtag.replace(/\\"/g, '"')
        logger.info('Cleaned escaped quotes from etag')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'If-Match': cleanedEtag,
      }
    },
  },

  transformResponse: async (response: Response) => {
    logger.info('Plan deleted successfully')

    const result: MicrosoftPlannerDeletePlanResponse = {
      success: true,
      output: {
        deleted: true,
        metadata: {},
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the plan was deleted successfully' },
    deleted: { type: 'boolean', description: 'Confirmation of deletion' },
    metadata: { type: 'object', description: 'Additional metadata' },
  },
}
