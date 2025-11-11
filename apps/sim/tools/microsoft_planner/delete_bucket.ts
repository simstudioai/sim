import { createLogger } from '@/lib/logs/console/logger'
import type {
  MicrosoftPlannerDeleteBucketResponse,
  MicrosoftPlannerToolParams,
} from '@/tools/microsoft_planner/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MicrosoftPlannerDeleteBucket')

export const deleteBucketTool: ToolConfig<
  MicrosoftPlannerToolParams,
  MicrosoftPlannerDeleteBucketResponse
> = {
  id: 'microsoft_planner_delete_bucket',
  name: 'Delete Microsoft Planner Bucket',
  description: 'Delete a bucket from Microsoft Planner',
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
      description: 'The ID of the bucket to delete',
    },
    etag: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ETag value from the bucket to delete (If-Match header)',
    },
  },

  request: {
    url: (params) => {
      if (!params.bucketId) {
        throw new Error('Bucket ID is required')
      }
      return `https://graph.microsoft.com/v1.0/planner/buckets/${params.bucketId}`
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
    logger.info('Bucket deleted successfully')

    const result: MicrosoftPlannerDeleteBucketResponse = {
      success: true,
      output: {
        deleted: true,
        metadata: {},
      },
    }

    return result
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the bucket was deleted successfully' },
    deleted: { type: 'boolean', description: 'Confirmation of deletion' },
    metadata: { type: 'object', description: 'Additional metadata' },
  },
}
