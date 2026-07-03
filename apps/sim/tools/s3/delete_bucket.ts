import type { ToolConfig } from '@/tools/types'

export const s3DeleteBucketTool: ToolConfig = {
  id: 's3_delete_bucket',
  name: 'S3 Delete Bucket',
  description: 'Delete an empty AWS S3 bucket',
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
      description: 'AWS region where the bucket is located (e.g., us-east-1)',
    },
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the S3 bucket to delete (must be empty)',
    },
  },

  request: {
    url: '/api/tools/s3/delete-bucket',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          deleted: false,
          metadata: {
            error: data.error || 'Failed to delete bucket',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        deleted: true,
        metadata: {
          bucket: data.output.bucket,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the bucket was successfully deleted',
    },
    metadata: {
      type: 'object',
      description: 'Deletion metadata including bucket name',
    },
  },
}
