import type { ToolConfig } from '@/tools/types'

export const s3CopyObjectTool: ToolConfig = {
  id: 's3_copy_object',
  name: 'S3 Copy Object',
  description: 'Copy an object within or between AWS S3 buckets',
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
    sourceBucket: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Source bucket name',
    },
    sourceKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Source object key/path',
    },
    destinationBucket: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Destination bucket name',
    },
    destinationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Destination object key/path',
    },
    acl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Access control list for the copied object (e.g., private, public-read)',
    },
  },

  request: {
    url: '/api/tools/s3/copy-object',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      sourceBucket: params.sourceBucket,
      sourceKey: params.sourceKey,
      destinationBucket: params.destinationBucket,
      destinationKey: params.destinationKey,
      acl: params.acl,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          url: '',
          metadata: {
            error: data.error || 'Failed to copy object',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        url: data.output.url,
        metadata: {
          copySourceVersionId: data.output.copySourceVersionId,
          versionId: data.output.versionId,
          etag: data.output.etag,
        },
      },
    }
  },

  outputs: {
    url: {
      type: 'string',
      description: 'URL of the copied S3 object',
    },
    metadata: {
      type: 'object',
      description: 'Copy operation metadata',
    },
  },
}
