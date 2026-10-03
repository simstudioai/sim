import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { createLogger } from '@sim/logger'
import {
  assertKnownSizeWithinLimit,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getOciObjectStorageServiceAccountSecret } from '@/lib/credentials/oci-object-storage-service-account'
import {
  sendOciListBuckets,
  withOciObjectStorageClient,
} from '@/lib/internal/oci-object-storage/client'
import { OciObjectStorageOperationError } from '@/lib/internal/oci-object-storage/errors'
import type {
  OciObjectStorageDeleteObjectInput,
  OciObjectStorageDownloadObjectInput,
  OciObjectStorageHeadObjectInput,
  OciObjectStorageListBucketsInput,
  OciObjectStorageListObjectsInput,
  OciObjectStorageUploadObjectInput,
} from '@/lib/internal/oci-object-storage/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('OciObjectStorageOperations')

export interface OciObjectStorageOperationContext {
  userId?: string
  requestId: string
  signal?: AbortSignal
}

function objectFileName(objectKey: string): string {
  const segments = objectKey.split('/').filter(Boolean)
  return segments.at(-1) || 'download'
}

export async function executeOciObjectStorageListBuckets(
  input: OciObjectStorageListBucketsInput,
  signal?: AbortSignal
) {
  const secret = await getOciObjectStorageServiceAccountSecret(input.credentialId)
  return withOciObjectStorageClient(secret, 3, async (client) => {
    const response = await sendOciListBuckets(client, signal)
    return {
      success: true as const,
      output: {
        buckets: (response.Buckets ?? [])
          .filter((bucket): bucket is typeof bucket & { Name: string } => Boolean(bucket.Name))
          .map((bucket) => ({
            name: bucket.Name,
            creationDate: bucket.CreationDate?.toISOString() ?? null,
          })),
        owner: response.Owner
          ? {
              id: response.Owner.ID ?? null,
              displayName: response.Owner.DisplayName ?? null,
            }
          : null,
      },
    }
  })
}

export async function executeOciObjectStorageListObjects(
  input: OciObjectStorageListObjectsInput,
  signal?: AbortSignal
) {
  const secret = await getOciObjectStorageServiceAccountSecret(input.credentialId)
  return withOciObjectStorageClient(secret, 3, async (client) => {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: input.bucketName,
        Prefix: input.prefix,
        Delimiter: input.delimiter,
        MaxKeys: input.maxKeys,
        StartAfter: input.startAfter,
        ContinuationToken: input.continuationToken,
      }),
      { abortSignal: signal }
    )
    if (response.IsTruncated && !response.NextContinuationToken) {
      throw new OciObjectStorageOperationError(
        'Oracle Object Storage returned an invalid truncated object listing',
        502
      )
    }
    const objects = (response.Contents ?? []).map((object) => {
      if (!object.Key || !Number.isSafeInteger(object.Size) || (object.Size as number) < 0) {
        throw new OciObjectStorageOperationError(
          'Oracle Object Storage returned an invalid object listing',
          502
        )
      }
      return {
        key: object.Key,
        size: object.Size,
        lastModified: object.LastModified?.toISOString() ?? null,
        etag: object.ETag ?? null,
        storageClass: object.StorageClass ?? null,
      }
    })
    return {
      success: true as const,
      output: {
        bucket: response.Name ?? input.bucketName,
        objects,
        commonPrefixes: (response.CommonPrefixes ?? [])
          .map((entry) => entry.Prefix)
          .filter((prefix): prefix is string => typeof prefix === 'string'),
        keyCount: response.KeyCount ?? 0,
        maxKeys: response.MaxKeys ?? input.maxKeys,
        isTruncated: response.IsTruncated ?? false,
        nextContinuationToken: response.NextContinuationToken ?? null,
        continuationToken: response.ContinuationToken ?? input.continuationToken ?? null,
        startAfter: response.StartAfter ?? input.startAfter ?? null,
        prefix: response.Prefix ?? input.prefix ?? null,
        delimiter: response.Delimiter ?? input.delimiter ?? null,
      },
    }
  })
}

async function resolveUploadBody(
  input: OciObjectStorageUploadObjectInput,
  context: OciObjectStorageOperationContext
): Promise<{ body: Buffer; contentType: string }> {
  if (input.file) {
    if (!context.userId) {
      throw new OciObjectStorageOperationError('Authentication required', 401)
    }
    let userFile
    try {
      userFile = processSingleFileToUserFile(input.file, context.requestId, logger)
    } catch {
      throw new OciObjectStorageOperationError('Invalid file input', 400)
    }
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) throw new OciObjectStorageOperationError('File not found', 404)

    try {
      const downloaded = await downloadServableFileFromStorage(
        userFile,
        context.requestId,
        logger,
        { maxBytes: MAX_BUFFERED_TRANSFER_BYTES, signal: context.signal }
      )
      return {
        body: downloaded.buffer,
        contentType:
          input.contentType ||
          downloaded.contentType ||
          userFile.type ||
          'application/octet-stream',
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isDocNotReadyError(error)) {
        throw new OciObjectStorageOperationError(docNotReadyMessage(), 409)
      }
      throw error
    }
  }

  const body = Buffer.from(input.content ?? '', 'utf8')
  assertKnownSizeWithinLimit(body.length, MAX_BUFFERED_TRANSFER_BYTES, 'OCI inline upload')
  return { body, contentType: input.contentType || 'text/plain; charset=utf-8' }
}

export async function executeOciObjectStorageUploadObject(
  input: OciObjectStorageUploadObjectInput,
  context: OciObjectStorageOperationContext
) {
  context.signal?.throwIfAborted()
  const upload = await resolveUploadBody(input, context)
  const secret = await getOciObjectStorageServiceAccountSecret(input.credentialId)
  return withOciObjectStorageClient(secret, 1, async (client) => {
    const response = await client.send(
      new PutObjectCommand({
        Bucket: input.bucketName,
        Key: input.objectKey,
        Body: upload.body,
        ContentLength: upload.body.length,
        ContentType: upload.contentType,
      }),
      { abortSignal: context.signal }
    )
    return {
      success: true as const,
      output: {
        bucket: input.bucketName,
        key: input.objectKey,
        size: upload.body.length,
        contentType: upload.contentType,
        etag: response.ETag ?? null,
        checksumSha256: response.ChecksumSHA256 ?? null,
        requestId: response.$metadata.requestId ?? null,
      },
    }
  })
}

export async function executeOciObjectStorageHeadObject(
  input: OciObjectStorageHeadObjectInput,
  signal?: AbortSignal
) {
  const secret = await getOciObjectStorageServiceAccountSecret(input.credentialId)
  return withOciObjectStorageClient(secret, 3, async (client) => {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: input.bucketName, Key: input.objectKey }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        bucket: input.bucketName,
        key: input.objectKey,
        contentLength: response.ContentLength ?? null,
        contentType: response.ContentType ?? null,
        contentEncoding: response.ContentEncoding ?? null,
        contentLanguage: response.ContentLanguage ?? null,
        cacheControl: response.CacheControl ?? null,
        contentDisposition: response.ContentDisposition ?? null,
        etag: response.ETag ?? null,
        lastModified: response.LastModified?.toISOString() ?? null,
        storageClass: response.StorageClass ?? null,
        metadata: response.Metadata ?? {},
        checksumSha256: response.ChecksumSHA256 ?? null,
        requestId: response.$metadata.requestId ?? null,
      },
    }
  })
}

export async function executeOciObjectStorageDownloadObject(
  input: OciObjectStorageDownloadObjectInput,
  signal?: AbortSignal
) {
  const secret = await getOciObjectStorageServiceAccountSecret(input.credentialId)
  return withOciObjectStorageClient(secret, 3, async (client) => {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: input.bucketName, Key: input.objectKey }),
      { abortSignal: signal }
    )
    if (head.ContentLength !== undefined) {
      assertKnownSizeWithinLimit(
        head.ContentLength,
        MAX_BUFFERED_TRANSFER_BYTES,
        'OCI object download'
      )
    }

    const response = await client.send(
      new GetObjectCommand({ Bucket: input.bucketName, Key: input.objectKey }),
      { abortSignal: signal }
    )
    const buffer = await readNodeStreamToBufferWithLimit(
      response.Body as NodeJS.ReadableStream | undefined,
      {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
        label: 'OCI object download',
        signal,
      }
    )
    return {
      success: true as const,
      output: {
        file: {
          name: objectFileName(input.objectKey),
          mimeType: response.ContentType || head.ContentType || 'application/octet-stream',
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        bucket: input.bucketName,
        key: input.objectKey,
        contentLength: buffer.length,
        contentType: response.ContentType || head.ContentType || 'application/octet-stream',
        etag: response.ETag ?? head.ETag ?? null,
        lastModified:
          response.LastModified?.toISOString() ?? head.LastModified?.toISOString() ?? null,
        metadata: response.Metadata ?? head.Metadata ?? {},
        requestId: response.$metadata.requestId ?? null,
      },
    }
  })
}

export async function executeOciObjectStorageDeleteObject(
  input: OciObjectStorageDeleteObjectInput,
  signal?: AbortSignal
) {
  const secret = await getOciObjectStorageServiceAccountSecret(input.credentialId)
  return withOciObjectStorageClient(secret, 1, async (client) => {
    const response = await client.send(
      new DeleteObjectCommand({ Bucket: input.bucketName, Key: input.objectKey }),
      { abortSignal: signal }
    )
    return {
      success: true as const,
      output: {
        deleted: true as const,
        bucket: input.bucketName,
        key: input.objectKey,
        requestId: response.$metadata.requestId ?? null,
      },
    }
  })
}
