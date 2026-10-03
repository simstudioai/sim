import {
  type BucketCannedACL,
  type BucketLocationConstraint,
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  type ObjectCannedACL,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { AwsS3CopyObjectBody } from '@/lib/api/contracts/tools/aws/s3-copy-object'
import type { AwsS3CreateBucketBody } from '@/lib/api/contracts/tools/aws/s3-create-bucket'
import type { AwsS3DeleteBucketBody } from '@/lib/api/contracts/tools/aws/s3-delete-bucket'
import type { AwsS3DeleteObjectBody } from '@/lib/api/contracts/tools/aws/s3-delete-object'
import type { AwsS3DeleteObjectsBody } from '@/lib/api/contracts/tools/aws/s3-delete-objects'
import type { AwsS3HeadObjectBody } from '@/lib/api/contracts/tools/aws/s3-head-object'
import type { AwsS3ListBucketsBody } from '@/lib/api/contracts/tools/aws/s3-list-buckets'
import type { AwsS3ListObjectsBody } from '@/lib/api/contracts/tools/aws/s3-list-objects'
import type { AwsS3PresignedUrlBody } from '@/lib/api/contracts/tools/aws/s3-presigned-url'
import type { AwsS3PutObjectBody } from '@/lib/api/contracts/tools/aws/s3-put-object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { createS3Client, type S3ConnectionConfig } from '@/lib/internal/s3/client'
import { S3OperationError } from '@/lib/internal/s3/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('S3Operations')

export interface S3OperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId?: string
}

async function withS3Client<T>(
  input: S3ConnectionConfig,
  execute: (client: S3Client) => Promise<T>
): Promise<T> {
  const client = createS3Client(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

function encodeObjectKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

export async function executeS3CopyObject(input: AwsS3CopyObjectBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    const encodedSourceKey = encodeObjectKey(input.sourceKey)
    const response = await client.send(
      new CopyObjectCommand({
        Bucket: input.destinationBucket,
        Key: input.destinationKey,
        CopySource: `${input.sourceBucket}/${encodedSourceKey}`,
        ACL: input.acl as ObjectCannedACL | undefined,
      }),
      { abortSignal: signal }
    )
    const encodedDestinationKey = encodeObjectKey(input.destinationKey)
    const url = `https://${input.destinationBucket}.s3.${input.region}.amazonaws.com/${encodedDestinationKey}`
    return {
      success: true as const,
      output: {
        url,
        uri: `s3://${input.destinationBucket}/${input.destinationKey}`,
        copySourceVersionId: response.CopySourceVersionId,
        versionId: response.VersionId,
        etag: response.CopyObjectResult?.ETag,
      },
    }
  })
}

export async function executeS3CreateBucket(input: AwsS3CreateBucketBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    const response = await client.send(
      new CreateBucketCommand({
        Bucket: input.bucketName,
        ACL: (input.acl as BucketCannedACL | undefined) || undefined,
        CreateBucketConfiguration:
          input.region === 'us-east-1'
            ? undefined
            : { LocationConstraint: input.region as BucketLocationConstraint },
      }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        bucket: input.bucketName,
        location: response.Location ?? null,
        bucketArn: response.BucketArn ?? null,
      },
    }
  })
}

export async function executeS3DeleteBucket(input: AwsS3DeleteBucketBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    await client.send(new DeleteBucketCommand({ Bucket: input.bucketName }), {
      abortSignal: signal,
    })
    return {
      success: true as const,
      output: { deleted: true as const, bucket: input.bucketName },
    }
  })
}

export async function executeS3DeleteObject(input: AwsS3DeleteObjectBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    const response = await client.send(
      new DeleteObjectCommand({ Bucket: input.bucketName, Key: input.objectKey }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        key: input.objectKey,
        deleteMarker: response.DeleteMarker,
        versionId: response.VersionId,
      },
    }
  })
}

export async function executeS3DeleteObjects(input: AwsS3DeleteObjectsBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: input.bucketName,
        Delete: {
          Objects: input.keys.map((key) => ({ Key: key })),
          Quiet: input.quiet ?? false,
        },
      }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        deleted: (response.Deleted ?? []).map((object) => ({
          key: object.Key ?? null,
          versionId: object.VersionId ?? null,
          deleteMarker: object.DeleteMarker ?? null,
        })),
        errors: (response.Errors ?? []).map((error) => ({
          key: error.Key ?? null,
          code: error.Code ?? null,
          message: error.Message ?? null,
        })),
      },
    }
  })
}

export async function executeS3HeadObject(input: AwsS3HeadObjectBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    try {
      const response = await client.send(
        new HeadObjectCommand({
          Bucket: input.bucketName,
          Key: input.objectKey,
          VersionId: input.versionId || undefined,
        }),
        { abortSignal: signal }
      )
      return {
        success: true as const,
        output: {
          exists: true,
          contentLength: response.ContentLength ?? null,
          contentType: response.ContentType ?? null,
          etag: response.ETag ?? null,
          lastModified: response.LastModified?.toISOString() ?? null,
          versionId: response.VersionId ?? null,
          storageClass: response.StorageClass ?? null,
          serverSideEncryption: response.ServerSideEncryption ?? null,
          deleteMarker: response.DeleteMarker ?? null,
          metadata: response.Metadata ?? {},
        },
      }
    } catch (error) {
      signal?.throwIfAborted()
      const metadata = error as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (metadata.name !== 'NotFound' && metadata.$metadata?.httpStatusCode !== 404) throw error
      return {
        success: true as const,
        output: {
          exists: false,
          contentLength: null,
          contentType: null,
          etag: null,
          lastModified: null,
          versionId: null,
          storageClass: null,
          serverSideEncryption: null,
          deleteMarker: null,
          metadata: {},
        },
      }
    }
  })
}

export async function executeS3ListBuckets(input: AwsS3ListBucketsBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    const response = await client.send(
      new ListBucketsCommand({
        Prefix: input.prefix || undefined,
        MaxBuckets: input.maxBuckets || undefined,
        ContinuationToken: input.continuationToken || undefined,
      }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        buckets: (response.Buckets ?? []).map((bucket) => ({
          name: bucket.Name || '',
          creationDate: bucket.CreationDate?.toISOString() ?? null,
          region: bucket.BucketRegion ?? null,
        })),
        owner: response.Owner
          ? {
              displayName: response.Owner.DisplayName ?? null,
              id: response.Owner.ID ?? null,
            }
          : null,
        continuationToken: response.ContinuationToken ?? null,
        prefix: response.Prefix ?? null,
      },
    }
  })
}

export async function executeS3ListObjects(input: AwsS3ListObjectsBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: input.bucketName,
        Prefix: input.prefix || undefined,
        MaxKeys: input.maxKeys || undefined,
        ContinuationToken: input.continuationToken || undefined,
      }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        objects: (response.Contents ?? []).map((object) => ({
          key: object.Key || '',
          size: object.Size || 0,
          lastModified: object.LastModified?.toISOString() || '',
          etag: object.ETag || '',
        })),
        isTruncated: response.IsTruncated,
        nextContinuationToken: response.NextContinuationToken,
        keyCount: response.KeyCount,
        prefix: input.prefix,
      },
    }
  })
}

export async function executeS3PresignedUrl(input: AwsS3PresignedUrlBody, signal?: AbortSignal) {
  return withS3Client(input, async (client) => {
    signal?.throwIfAborted()
    const command =
      input.method === 'put'
        ? new PutObjectCommand({
            Bucket: input.bucketName,
            Key: input.objectKey,
            ContentType: input.contentType || undefined,
          })
        : new GetObjectCommand({ Bucket: input.bucketName, Key: input.objectKey })
    const url = await getSignedUrl(client, command, { expiresIn: input.expiresIn })
    signal?.throwIfAborted()
    return {
      success: true as const,
      output: {
        url,
        method: input.method,
        expiresIn: input.expiresIn,
        expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
      },
    }
  })
}

export async function executeS3PutObject(input: AwsS3PutObjectBody, context: S3OperationContext) {
  const { requestId, signal, userId } = context
  signal?.throwIfAborted()
  if (!userId) throw new S3OperationError('Authentication required', 401)

  let uploadBody: Buffer | string
  let uploadContentType: string | undefined
  if (input.file) {
    let userFile: ReturnType<typeof processSingleFileToUserFile>
    try {
      userFile = processSingleFileToUserFile(input.file, requestId, logger)
    } catch (error) {
      throw new S3OperationError(getErrorMessage(error, 'Failed to process file'), 400)
    }

    const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
    if (denied) throw new S3OperationError('File not found', 404)
    signal?.throwIfAborted()

    try {
      const downloaded = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })
      signal?.throwIfAborted()
      uploadBody = downloaded.buffer
      uploadContentType =
        input.contentType || downloaded.contentType || userFile.type || 'application/octet-stream'
    } catch (error) {
      signal?.throwIfAborted()
      if (isDocNotReadyError(error)) {
        throw new S3OperationError(docNotReadyMessage(), 409)
      }
      throw new S3OperationError(
        getErrorMessage(error, 'Failed to download file'),
        isPayloadSizeLimitError(error) ? 413 : 500
      )
    }
  } else if (input.content) {
    uploadBody = Buffer.from(input.content, 'utf-8')
    uploadContentType = input.contentType || 'text/plain'
  } else {
    throw new S3OperationError('Either file or content must be provided', 400)
  }

  return withS3Client(input, async (client) => {
    const response = await client.send(
      new PutObjectCommand({
        Bucket: input.bucketName,
        Key: input.objectKey,
        Body: uploadBody,
        ContentType: uploadContentType,
        ACL: input.acl as ObjectCannedACL | undefined,
      }),
      { abortSignal: signal }
    )
    const encodedKey = encodeObjectKey(input.objectKey)
    const url = `https://${input.bucketName}.s3.${input.region}.amazonaws.com/${encodedKey}`
    return {
      success: true as const,
      output: {
        url,
        uri: `s3://${input.bucketName}/${input.objectKey}`,
        etag: response.ETag,
        location: url,
        key: input.objectKey,
        bucket: input.bucketName,
      },
    }
  })
}
