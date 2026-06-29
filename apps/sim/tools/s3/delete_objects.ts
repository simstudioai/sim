import type { ToolConfig } from '@/tools/types'

export const s3DeleteObjectsTool: ToolConfig = {
  id: 's3_delete_objects',
  name: 'S3 Delete Objects',
  description: 'Delete multiple objects from an AWS S3 bucket in a single batch request',
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
      visibility: 'user-or-llm',
      description: 'S3 bucket name (e.g., my-bucket)',
    },
    keys: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of object keys to delete (e.g., ["a.txt", "folder/b.txt"]). Max 1000.',
    },
    quiet: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only deletion errors, omitting successfully deleted keys',
    },
  },

  request: {
    url: '/api/tools/s3/delete-objects',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      keys: params.keys,
      quiet: params.quiet,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          deleted: [],
          errors: [],
          metadata: {
            error: data.error || 'Failed to delete objects',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        deleted: data.output.deleted || [],
        errors: data.output.errors || [],
        metadata: {
          deletedCount: (data.output.deleted || []).length,
          errorCount: (data.output.errors || []).length,
        },
      },
    }
  },

  outputs: {
    deleted: {
      type: 'array',
      description: 'Objects that were successfully deleted',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Deleted object key' },
          versionId: { type: 'string', description: 'Version ID of the deleted object' },
          deleteMarker: { type: 'boolean', description: 'Whether a delete marker was created' },
        },
      },
    },
    errors: {
      type: 'array',
      description: 'Objects that failed to delete',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Object key that failed' },
          code: { type: 'string', description: 'Error code' },
          message: { type: 'string', description: 'Error message' },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Batch deletion summary including counts',
    },
  },
}
