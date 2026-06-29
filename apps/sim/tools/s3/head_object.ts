import type { ToolConfig } from '@/tools/types'

export const s3HeadObjectTool: ToolConfig = {
  id: 's3_head_object',
  name: 'S3 Head Object',
  description: 'Retrieve metadata for an S3 object without downloading its body',
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
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object key/path to inspect (e.g., folder/file.txt)',
    },
    versionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific object version ID to inspect (for versioned buckets)',
    },
  },

  request: {
    url: '/api/tools/s3/head-object',
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
      versionId: params.versionId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          exists: false,
          metadata: {
            error: data.error || 'Failed to retrieve object metadata',
          },
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        exists: data.output.exists,
        metadata: {
          size: data.output.contentLength ?? null,
          fileType: data.output.contentType ?? null,
          etag: data.output.etag ?? null,
          lastModified: data.output.lastModified ?? null,
          versionId: data.output.versionId ?? null,
          storageClass: data.output.storageClass ?? null,
          serverSideEncryption: data.output.serverSideEncryption ?? null,
          deleteMarker: data.output.deleteMarker ?? null,
          userMetadata: data.output.metadata ?? {},
        },
      },
    }
  },

  outputs: {
    exists: {
      type: 'boolean',
      description: 'Whether the object exists and was reachable',
    },
    metadata: {
      type: 'object',
      description: 'Object metadata including size, content type, ETag, and last modified date',
    },
  },
}
