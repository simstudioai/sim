import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerListBucketsResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerListBuckets')

export const listBucketsTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerListBucketsResponse
> = {
  id: 'microsoft_planner_list_buckets',
  name: 'List Microsoft Planner Buckets',
  description: 'List all buckets in a Microsoft Planner plan',
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
      visibility: 'user-only',
      description: 'The ID of the plan',
    },
  },

  request: {
    url: (params) => {
      if (!params.planId) {
        throw new Error('Plan ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/plans/${params.planId}/buckets`
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
    logger.info('List buckets response:', data)

    const buckets = data.value || []

    const result: MicrosoftPlannerListBucketsResponse = {
      success: true,
      output: {
        buckets,
        metadata: {
          planId: buckets.length > 0 ? buckets[0].planId : undefined,
          count: buckets.length,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether buckets were retrieved successfully' },
    buckets: { type: 'array', description: 'Array of bucket objects' },
    metadata: { type: 'object', description: 'Metadata including planId and count' },
  },
}
