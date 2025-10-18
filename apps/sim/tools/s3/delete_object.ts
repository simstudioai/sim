import type { ToolConfig } from '@/tools/types'

export const s3DeleteObjectTool: ToolConfig = {
  id: 's3_delete_object',
  name: 'S3 Delete Object',
  description: 'Delete an object from an AWS S3 bucket',
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
      description: 'Object key/path to delete',
    },
  },

  request: {
    url: '/api/tools/s3/delete-object',
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
            error: data.error || 'Failed to delete object',
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
          key: data.output.key,
          deleteMarker: data.output.deleteMarker,
          versionId: data.output.versionId,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the object was successfully deleted',
    },
    metadata: {
      type: 'object',
      description: 'Deletion metadata',
    },
  },
}
