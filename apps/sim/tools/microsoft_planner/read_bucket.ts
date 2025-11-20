import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerReadBucketResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerReadBucket')

export const readBucketTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerReadBucketResponse
> = {
  id: 'microsoft_planner_read_bucket',
  name: 'Read Microsoft Planner Bucket',
  description: 'Get details of a specific bucket',
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
    bucketId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the bucket to retrieve',
    },
  },

  request: {
    url: (params) => {
      if (!params.bucketId) {
        throw new Error('Bucket ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/buckets/${params.bucketId}`
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
    const bucket = await response.json()
    logger.info('Read bucket response:', bucket)

    const result: MicrosoftPlannerReadBucketResponse = {
      success: true,
      output: {
        bucket,
        metadata: {
          bucketId: bucket.id,
          planId: bucket.planId,
        },
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the bucket was retrieved successfully' },
    bucket: { type: 'object', description: 'The bucket object with all properties' },
    metadata: { type: 'object', description: 'Metadata including bucketId and planId' },
  },
}
