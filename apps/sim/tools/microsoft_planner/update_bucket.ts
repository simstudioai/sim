import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdateBucketResponse,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerUpdateBucket')

export const updateBucketTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerUpdateBucketResponse
> = {
  id: 'microsoft_planner_update_bucket',
  name: 'Update Microsoft Planner Bucket',
  description: 'Update a bucket in Microsoft Planner',
  version: '1.0',
  errorExtractor: 'nested-error-object',

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
      description: 'The ID of the bucket to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The new name of the bucket',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the bucket to update (If-Match header)',
    },
  },

  request: {
    url: (params) => {
      if (!params.bucketId) {
        throw new Error('Bucket ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/buckets/${params.bucketId}`
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
        logger.info('Removed surrounding quotes:', cleanedEtag)
      }

      if (cleanedEtag.includes('\\"')) {
        cleanedEtag = cleanedEtag.replace(/\\"/g, '"')
        logger.info('Cleaned escaped quotes from etag')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        'If-Match': cleanedEtag,
      }
    },
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.name) {
        body.name = params.name
      }

      if (Object.keys(body).length === 0) {
        throw new Error('At least one field must be provided to update')
      }

      logger.info('Updating bucket with body:', body)
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const bucket = await response.json()
    logger.info('Updated bucket:', bucket)

    const result: MicrosoftPlannerUpdateBucketResponse = {
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
    success: { type: 'boolean', description: 'Whether the bucket was updated successfully' },
    bucket: { type: 'object', description: 'The updated bucket object with all properties' },
    metadata: { type: 'object', description: 'Metadata including bucketId and planId' },
  },
}
