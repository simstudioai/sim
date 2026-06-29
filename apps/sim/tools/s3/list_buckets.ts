import type { ToolConfig } from '@/tools/types'

export const s3ListBucketsTool: ToolConfig = {
  id: 's3_list_buckets',
  name: 'S3 List Buckets',
  description: 'List the S3 buckets owned by the authenticated AWS account',
  version: '1.0.0',

  params: {
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your AWS Access Key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your AWS Secret Access Key',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region to address the request to (e.g., us-east-1)',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Limit the response to bucket names that begin with this prefix',
    },
    maxBuckets: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of buckets to return (1-10000)',
    },
    continuationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination from a previous list buckets response',
    },
  },

  request: {
    url: '/api/tools/s3/list-buckets',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      prefix: params.prefix,
      maxBuckets: params.maxBuckets !== undefined ? Number(params.maxBuckets) : undefined,
      continuationToken: params.continuationToken,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          buckets: [],
          metadata: {
            error: data.error || 'Failed to list buckets',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        buckets: data.output.buckets || [],
        metadata: {
          owner: data.output.owner ?? null,
          continuationToken: data.output.continuationToken ?? null,
          prefix: data.output.prefix ?? null,
        },
      },
    }
  },

  outputs: {
    buckets: {
      type: 'array',
      description: 'List of S3 buckets owned by the account',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bucket name' },
          creationDate: { type: 'string', description: 'Bucket creation timestamp' },
          region: { type: 'string', description: 'AWS region where the bucket is located' },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Listing metadata including owner and pagination info',
    },
  },
}
