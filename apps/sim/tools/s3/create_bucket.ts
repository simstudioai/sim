import type { ToolConfig } from '@/tools/types'

export const s3CreateBucketTool: ToolConfig = {
  id: 's3_create_bucket',
  name: 'S3 Create Bucket',
  description: 'Create a new AWS S3 bucket in the specified region',
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
      description: 'AWS region to create the bucket in (e.g., us-east-1)',
    },
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the new S3 bucket (must be globally unique)',
    },
    acl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Canned ACL for the bucket (e.g., private, public-read)',
    },
  },

  request: {
    url: '/api/tools/s3/create-bucket',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      acl: params.acl,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          metadata: {
            error: data.error || 'Failed to create bucket',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        metadata: {
          bucket: data.output.bucket,
          location: data.output.location ?? null,
          bucketArn: data.output.bucketArn ?? null,
        },
      },
    }
  },

  outputs: {
    metadata: {
      type: 'object',
      description: 'Created bucket metadata including name and location',
    },
  },
}
