import type { ToolConfig } from '@/tools/types'

export const s3ListObjectsTool: ToolConfig = {
  id: 's3_list_objects',
  name: 'S3 List Objects',
  description: 'List objects in an AWS S3 bucket',
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
      description: 'AWS region (e.g., us-east-1)',
    },
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'S3 bucket name',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Prefix to filter objects (e.g., folder/)',
    },
    maxKeys: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of objects to return (default: 1000)',
    },
    continuationToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Token for pagination',
    },
  },

  request: {
    url: '/api/tools/s3/list-objects',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      prefix: params.prefix,
      maxKeys: params.maxKeys !== undefined ? Number(params.maxKeys) : undefined,
      continuationToken: params.continuationToken,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          objects: [],
          metadata: {
            error: data.error || 'Failed to list objects',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        objects: data.output.objects || [],
        metadata: {
          isTruncated: data.output.isTruncated,
          nextContinuationToken: data.output.nextContinuationToken,
          keyCount: data.output.keyCount,
          prefix: data.output.prefix,
        },
      },
    }
  },

  outputs: {
    objects: {
      type: 'array',
      description: 'List of S3 objects',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Object key' },
          size: { type: 'number', description: 'Object size in bytes' },
          lastModified: { type: 'string', description: 'Last modified timestamp' },
          etag: { type: 'string', description: 'Entity tag' },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Listing metadata including pagination info',
    },
  },
}
