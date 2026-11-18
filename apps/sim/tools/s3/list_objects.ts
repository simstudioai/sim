import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const s3ListObjectsTool: InternalToolConfig = {
  id: 's3_list_objects',
  name: 'S3 List Objects',
  description: 'List objects in an AWS S3 bucket',
  version: '1.0.0',
  oauth: AWS_CREDENTIAL_OAUTH,

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
      visibility: 'user-or-llm',
      description: 'S3 bucket name (e.g., my-bucket)',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prefix to filter objects (e.g., folder/, images/2024/)',
    },
    maxKeys: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of objects to return (default: 1000)',
    },
    continuationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination from previous list response',
    },
    delimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Character that groups keys (usually /). Keys sharing a prefix up to the delimiter are returned once in commonPrefixes instead of in objects, like folders.',
    },
    startAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Key to start listing after (e.g., folder/file-100.txt)',
    },
  },

  operation: {
    input: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      prefix: params.prefix,
      maxKeys: params.maxKeys !== undefined ? Number(params.maxKeys) : undefined,
      continuationToken: params.continuationToken,
      delimiter: params.delimiter,
      startAfter: params.startAfter,
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
        commonPrefixes: data.output.commonPrefixes ?? [],
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
          storageClass: {
            type: 'string',
            description: 'Storage class (e.g., STANDARD, GLACIER)',
            optional: true,
          },
        },
      },
    },
    commonPrefixes: {
      type: 'array',
      description: 'Folder-like prefixes grouped by the delimiter (empty without a delimiter)',
      items: { type: 'string', description: 'Common prefix' },
      optional: true,
    },
    metadata: {
      type: 'object',
      description: 'Listing metadata including pagination info',
    },
  },
}
