import type { ToolConfig } from '@/tools/types'

export const s3PutObjectTool: ToolConfig = {
  id: 's3_put_object',
  name: 'S3 Put Object',
  description: 'Upload a file to an AWS S3 bucket',
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
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Object key/path in S3 (e.g., folder/filename.ext)',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'File to upload',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Text content to upload (alternative to file)',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Content-Type header (auto-detected from file if not provided)',
    },
    acl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Access control list (e.g., private, public-read)',
    },
  },

  request: {
    url: '/api/tools/s3/put-object',
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
      file: params.file,
      content: params.content,
      contentType: params.contentType,
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
            error: data.error || 'Failed to upload object',
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
          etag: data.output.etag,
          location: data.output.location,
          key: data.output.key,
          bucket: data.output.bucket,
        },
      },
    }
  },

  outputs: {
    url: {
      type: 'string',
      description: 'URL of the uploaded S3 object',
    },
    metadata: {
      type: 'object',
      description: 'Upload metadata including ETag and location',
    },
  },
}
