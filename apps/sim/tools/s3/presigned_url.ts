import type { ToolConfig } from '@/tools/types'

export const s3PresignedUrlTool: ToolConfig = {
  id: 's3_presigned_url',
  name: 'S3 Presigned URL',
  description: 'Generate a time-limited presigned URL to download or upload an S3 object',
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
      description: 'S3 bucket name (e.g., my-bucket)',
    },
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object key/path for the presigned URL (e.g., folder/file.txt)',
    },
    method: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Operation the URL grants: get (download) or put (upload)',
    },
    expiresIn: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL validity in seconds (1-604800, default 3600)',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content-Type the upload must use (only applies to put URLs)',
    },
  },

  request: {
    url: '/api/tools/s3/presigned-url',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      objectKey: params.objectKey,
      method: params.method,
      expiresIn: params.expiresIn !== undefined ? Number(params.expiresIn) : 3600,
      contentType: params.contentType,
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
            error: data.error || 'Failed to generate presigned URL',
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
          method: data.output.method,
          expiresIn: data.output.expiresIn,
          expiresAt: data.output.expiresAt,
        },
      },
    }
  },

  outputs: {
    url: {
      type: 'string',
      description: 'The generated presigned URL',
    },
    metadata: {
      type: 'object',
      description: 'Presigned URL metadata including method and expiration',
    },
  },
}
