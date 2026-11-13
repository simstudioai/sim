import { AWS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

function parseObjectMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('Object metadata must be a JSON object of string values')
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Object metadata must be a JSON object of string values')
  }
  const entries = Object.entries(parsed)
  if (entries.length === 0) return undefined
  return Object.fromEntries(
    entries.map(([key, entryValue]) => [
      key,
      typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue),
    ])
  )
}

export const s3PutObjectTool: InternalToolConfig = {
  id: 's3_put_object',
  name: 'S3 Put Object',
  description: 'Upload a file to an AWS S3 bucket',
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
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
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
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User-defined object metadata stored as x-amz-meta-* headers, as a JSON object of string values (e.g., {"department": "finance"})',
    },
    storageClass: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Storage class (e.g., STANDARD, STANDARD_IA, INTELLIGENT_TIERING, GLACIER_IR). Defaults to STANDARD.',
    },
    serverSideEncryption: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Server-side encryption algorithm: AES256, aws:kms, or aws:kms:dsse',
    },
    sseKmsKeyId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'KMS key ID or ARN to encrypt with when serverSideEncryption is aws:kms',
    },
  },

  operation: {
    input: (params) => ({
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      region: params.region,
      bucketName: params.bucketName,
      objectKey: params.objectKey,
      file: params.file,
      content: params.content,
      contentType: params.contentType,
      acl: params.acl,
      metadata: parseObjectMetadata(params.metadata),
      storageClass: params.storageClass,
      serverSideEncryption: params.serverSideEncryption,
      sseKmsKeyId: params.sseKmsKeyId,
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
        uri: data.output.uri,
        metadata: {
          etag: data.output.etag,
          location: data.output.location,
          key: data.output.key,
          bucket: data.output.bucket,
          versionId: data.output.versionId ?? null,
          serverSideEncryption: data.output.serverSideEncryption ?? null,
        },
      },
    }
  },

  outputs: {
    url: {
      type: 'string',
      description: 'URL of the uploaded S3 object',
    },
    uri: {
      type: 'string',
      description: 'S3 URI of the uploaded object (s3://bucket/key)',
    },
    metadata: {
      type: 'object',
      description:
        'Upload metadata: etag, location, key, bucket, versionId (versioned buckets), and serverSideEncryption',
    },
  },
}
