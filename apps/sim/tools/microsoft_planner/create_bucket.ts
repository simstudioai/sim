import { createLogger } from '@sim/logger'
import type {
  MicrosoftPlannerCreateBucketResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerCreateBucket')

export const createBucketTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerCreateBucketResponse
> = {
  id: 'microsoft_planner_create_bucket',
  name: 'Create Microsoft Planner Bucket',
  description: 'Create a new bucket in a Microsoft Planner plan',
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
      description:
        'The ID of the plan where the bucket will be created (e.g., "xqQg5FS2LkCe54tAMV_v2ZgADW2J")',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The name of the bucket',
    },
  },

  request: {
    url: () => 'https://graph.microsoft.com/v1.0/planner/buckets',
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
      if (!params.planId) {
        throw new Error('Plan ID is required')
      }
      if (!params.name) {
        throw new Error('Bucket name is required')
      }

      const body = {
        name: params.name,
        planId: params.planId,
        orderHint: ' !',
      }

      logger.info('Creating bucket with body:', body)
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const bucket = await response.json()
    logger.info('Created bucket:', bucket)

    const result: MicrosoftPlannerCreateBucketResponse = {
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
    success: { type: 'boolean', description: 'Whether the bucket was created successfully' },
    bucket: { type: 'object', description: 'The created bucket object with all properties' },
    metadata: {
      type: 'object',
      description: 'Metadata including bucketId and planId',
      properties: {
        bucketId: { type: 'string', description: 'Created bucket ID' },
        planId: { type: 'string', description: 'Parent plan ID' },
      },
    },
  },
}
