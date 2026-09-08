import type { Readable } from 'node:stream'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getAwsCredentialsFromEnv } from '@/lib/core/config/aws'
import {
  assertKnownSizeWithinLimit,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { S3_CONFIG, S3_KB_CONFIG } from '@/lib/uploads/config'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import type {
  S3Config,
  S3MultipartPart,
  S3MultipartUploadInit,
  S3PartUploadUrl,
} from '@/lib/uploads/providers/s3/types'
import type {
  FileInfo,
  MultipartCompletionPolicy,
  StoredObjectInfo,
} from '@/lib/uploads/shared/types'
import {
  sanitizeFilenameForMetadata,
  sanitizeStorageMetadata,
} from '@/lib/uploads/utils/file-utils'
import { sanitizeFileName } from '@/executor/constants'

let _s3Client: S3Client | null = null

/**
 * Reset the cached S3 client. Only intended for use in tests.
 */
export function resetS3ClientForTesting(): void {
  _s3Client = null
}

export function getS3Client(): S3Client {
  if (_s3Client) return _s3Client

  const { region } = S3_CONFIG

  if (!region) {
    throw new Error(
      'AWS region is missing – set AWS_REGION in your environment or disable S3 uploads.'
    )
  }

  _s3Client = new S3Client({
    region,
    endpoint: S3_CONFIG.endpoint,
    forcePathStyle: S3_CONFIG.forcePathStyle,
    credentials: getAwsCredentialsFromEnv(),
  })

  return _s3Client
}

/**
 * Upload a file to S3
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param configOrSize Custom S3 configuration OR file size in bytes (optional)
 * @param size File size in bytes (required if configOrSize is S3Config, optional otherwise)
 * @param skipTimestampPrefix Skip adding timestamp prefix to filename (default: false)
 * @param metadata Optional metadata to store with the file
 * @param createOnly Reject an existing key instead of replacing its object
 * @returns Object with file information
 */
export async function uploadToS3(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: S3Config | number,
  size?: number,
  skipTimestampPrefix?: boolean,
  metadata?: Record<string, string>,
  createOnly = false
): Promise<FileInfo> {
  let config: S3Config
  let fileSize: number
  let shouldSkipTimestamp: boolean

  if (typeof configOrSize === 'object') {
    config = configOrSize
    fileSize = size ?? file.length
    shouldSkipTimestamp = skipTimestampPrefix ?? false
  } else {
    config = { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }
    fileSize = configOrSize ?? file.length
    shouldSkipTimestamp = skipTimestampPrefix ?? false
  }

  const safeFileName = sanitizeFileName(fileName)
  const uniqueKey = shouldSkipTimestamp ? fileName : `${Date.now()}-${safeFileName}`

  const s3Client = getS3Client()

  const s3Metadata: Record<string, string> = {
    originalName: sanitizeFilenameForMetadata(fileName),
    uploadedAt: new Date().toISOString(),
  }

  if (metadata) {
    Object.assign(s3Metadata, sanitizeStorageMetadata(metadata, 2000))
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: uniqueKey,
      Body: file,
      ContentType: contentType,
      Metadata: s3Metadata,
      ...(createOnly ? { IfNoneMatch: '*' } : {}),
    })
  )

  const servePath = `/api/files/serve/${encodeURIComponent(uniqueKey)}`

  return {
    path: servePath,
    key: uniqueKey,
    name: fileName,
    size: fileSize,
    type: contentType,
  }
}

/**
 * Generate a presigned URL for direct file access
 * @param key S3 object key
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: key,
  })

  return getSignedUrl(getS3Client(), command, { expiresIn })
}

/**
 * Generate a presigned URL for direct file access with custom bucket
 * @param key S3 object key
 * @param customConfig Custom S3 configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: S3Config,
  expiresIn = 3600
) {
  const command = new GetObjectCommand({
    Bucket: customConfig.bucket,
    Key: key,
  })

  return getSignedUrl(getS3Client(), command, { expiresIn })
}

/**
 * Generates a create-only signed single-object PUT for a caller-selected final key.
 * The AWS presigner hoists `x-amz-meta-*` values into the signed query string,
 * so only ordinary transfer headers are returned. Repeating that metadata as
 * request headers makes S3 reject the otherwise-valid signature.
 */
export async function getS3PresignedUploadUrl(params: {
  key: string
  contentType: string
  fileSize: number
  metadata: Record<string, string>
  customConfig: S3Config
  expiresIn: number
}): Promise<{ url: string; headers: Record<string, string> }> {
  const metadata = sanitizeStorageMetadata(params.metadata, 2000)
  const command = new PutObjectCommand({
    Bucket: params.customConfig.bucket,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.fileSize,
    IfNoneMatch: '*',
    Metadata: metadata,
  })
  const url = await getSignedUrl(getS3Client(), command, { expiresIn: params.expiresIn })
  return {
    url,
    headers: {
      'Content-Type': params.contentType,
      'If-None-Match': '*',
    },
  }
}

/**
 * Download a file from S3
 * @param key S3 object key
 * @returns File buffer
 */
export async function downloadFromS3(key: string): Promise<Buffer>

/**
 * Download a file from S3 with custom bucket configuration
 * @param key S3 object key
 * @param customConfig Custom S3 configuration
 * @returns File buffer
 */
export async function downloadFromS3(key: string, customConfig: S3Config): Promise<Buffer>

export async function downloadFromS3(
  key: string,
  customConfig: S3Config,
  maxBytes: number
): Promise<Buffer>

export async function downloadFromS3(
  key: string,
  customConfig: S3Config,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined
): Promise<Buffer>

export async function downloadFromS3(
  key: string,
  customConfig?: S3Config,
  maxBytes?: number,
  signal?: AbortSignal
): Promise<Buffer> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
  })

  const response = await getS3Client().send(command, { abortSignal: signal })
  if (maxBytes !== undefined && response.ContentLength !== undefined) {
    try {
      assertKnownSizeWithinLimit(response.ContentLength, maxBytes, 'storage download')
    } catch (error) {
      const body = response.Body as { destroy?: (error?: Error) => void } | undefined
      body?.destroy?.(error instanceof Error ? error : undefined)
      throw error
    }
  }

  const stream = response.Body as NodeJS.ReadableStream
  return readNodeStreamToBufferWithLimit(stream, {
    maxBytes: maxBytes ?? Number.MAX_SAFE_INTEGER,
    label: 'storage download',
    signal,
  })
}

/**
 * Stream an object out of S3 without buffering it. The caller MUST fully consume or
 * `destroy()` the returned stream. Used by the large-CSV import worker so a 1M-row file is
 * never resident in memory.
 */
export async function downloadFromS3Stream(
  key: string,
  customConfig?: S3Config
): Promise<Readable> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: key })
  const response = await getS3Client().send(command)
  if (!response.Body) {
    throw new Error(`S3 object has no body: ${key}`)
  }
  return response.Body as Readable
}

/**
 * Check whether an object exists in S3 (and return its size when it does).
 * Returns null when the object is missing.
 */
export async function headS3Object(
  key: string,
  customConfig?: S3Config
): Promise<StoredObjectInfo | null> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }

  try {
    const response = await getS3Client().send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key })
    )
    const uploadId = readUploadId(response.Metadata)
    return {
      size: response.ContentLength ?? 0,
      contentType: response.ContentType,
      ...(uploadId ? { uploadId } : {}),
      ...(response.ETag ? { version: response.ETag } : {}),
      ...(response.Metadata ? { metadata: response.Metadata } : {}),
    }
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      return null
    }
    throw error
  }
}

/** Deletes an upload object only if it is still the version the caller inspected. */
export async function deleteS3ObjectVersion(params: {
  key: string
  etag: string
  customConfig: S3Config
}): Promise<void> {
  if (!params.etag) throw new Error('S3 upload object is missing its ETag')
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: params.customConfig.bucket,
      Key: params.key,
      IfMatch: params.etag,
    })
  )
}

/**
 * Delete a file from S3
 * @param key S3 object key
 */
export async function deleteFromS3(key: string): Promise<void>

/**
 * Delete a file from S3 with custom bucket configuration
 * @param key S3 object key
 * @param customConfig Custom S3 configuration
 */
export async function deleteFromS3(key: string, customConfig: S3Config): Promise<void>

export async function deleteFromS3(key: string, customConfig?: S3Config): Promise<void> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  )
}

/** S3 `DeleteObjects` hard cap. */
const S3_DELETE_OBJECTS_MAX_KEYS = 1000

/**
 * Multi-object delete. One HTTP call per 1000 keys; each key still counts
 * against the per-prefix DELETE rate limit (3500/sec).
 */
export async function deleteManyFromS3(
  keys: string[],
  customConfig?: S3Config
): Promise<{ failed: Array<{ key: string; error: string }> }> {
  const failed: Array<{ key: string; error: string }> = []
  if (keys.length === 0) return { failed }

  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }
  const s3Client = getS3Client()

  for (let i = 0; i < keys.length; i += S3_DELETE_OBJECTS_MAX_KEYS) {
    const chunk = keys.slice(i, i + S3_DELETE_OBJECTS_MAX_KEYS)
    try {
      const response = await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      )
      for (const error of response.Errors ?? []) {
        if (error.Key) {
          failed.push({
            key: error.Key,
            error: error.Message ?? error.Code ?? 'unknown',
          })
        }
      }
    } catch (error) {
      const message = getErrorMessage(error)
      for (const Key of chunk) failed.push({ key: Key, error: message })
    }
  }

  return { failed }
}

/**
 * Initiate a multipart upload for S3
 */
export async function initiateS3MultipartUpload(
  options: S3MultipartUploadInit
): Promise<{ uploadId: string; key: string }> {
  const { fileName, contentType, customConfig, customKey, purpose, metadata } = options

  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const safeFileName = sanitizeFileName(fileName)
  const uniqueKey = customKey || `kb/${generateId()}-${safeFileName}`

  const command = new CreateMultipartUploadCommand({
    Bucket: config.bucket,
    Key: uniqueKey,
    ContentType: contentType,
    Metadata: {
      originalName: sanitizeFilenameForMetadata(fileName),
      uploadedAt: new Date().toISOString(),
      purpose: purpose || 'knowledge-base',
      ...sanitizeStorageMetadata(metadata ?? {}, 2000),
    },
  })

  const response = await s3Client.send(command)

  if (!response.UploadId) {
    throw new Error('Failed to initiate S3 multipart upload')
  }

  return {
    uploadId: response.UploadId,
    key: uniqueKey,
  }
}

function readUploadId(metadata?: Record<string, string>): string | undefined {
  if (!metadata) return undefined
  return Object.entries(metadata).find(([key]) => key.toLowerCase() === 'uploadid')?.[1]
}

/**
 * Upload a single multipart part from the server (Body in hand), returning its
 * `{ PartNumber, ETag }`. The presigned variant ({@link getS3MultipartPartUrls})
 * is for browser uploads; this is the server-side streaming path.
 */
export async function uploadS3Part(
  key: string,
  uploadId: string,
  partNumber: number,
  body: Buffer,
  customConfig?: S3Config
): Promise<S3MultipartPart> {
  const config = customConfig || { bucket: S3_CONFIG.bucket, region: S3_CONFIG.region }
  const response = await getS3Client().send(
    new UploadPartCommand({
      Bucket: config.bucket,
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
      Body: body,
    })
  )
  if (!response.ETag) {
    throw new Error(`S3 UploadPart returned no ETag for part ${partNumber} of ${key}`)
  }
  return { PartNumber: partNumber, ETag: response.ETag }
}

/**
 * Generate presigned URLs for uploading parts to S3.
 *
 * `expiresIn` is required rather than defaulted: the caller owns the part-URL lifetime and
 * advertises the matching `expiresAt` to the client, so a local default would be a second
 * source of truth that silently keeps signing 1h URLs after the caller's window changed.
 */
export async function getS3MultipartPartUrls(
  key: string,
  uploadId: string,
  partNumbers: number[],
  customConfig: S3Config | undefined,
  /** Signature lifetime, in seconds. */
  expiresIn: number
): Promise<S3PartUploadUrl[]> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const presignedUrls = await Promise.all(
    partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: config.bucket,
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
      })

      const url = await getSignedUrl(s3Client, command, { expiresIn })
      return { partNumber, url }
    })
  )

  return presignedUrls
}

/** Lists the provider-authoritative state for a multipart upload. */
export async function listS3MultipartParts(
  key: string,
  uploadId: string,
  customConfig?: S3Config
): Promise<Array<{ partNumber: number; etag: string; size: number }>> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const parts: Array<{ partNumber: number; etag: string; size: number }> = []
  let partNumberMarker: string | undefined

  for (;;) {
    const response = await getS3Client().send(
      new ListPartsCommand({
        Bucket: config.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: partNumberMarker,
      })
    )
    for (const part of response.Parts ?? []) {
      if (part.PartNumber === undefined || part.ETag === undefined || part.Size === undefined) {
        throw new Error(`S3 returned incomplete part metadata for ${key}`)
      }
      parts.push({ partNumber: part.PartNumber, etag: part.ETag, size: part.Size })
    }
    if (!response.IsTruncated) break
    if (response.NextPartNumberMarker === undefined) {
      throw new Error(`S3 truncated the part listing for ${key} without a continuation marker`)
    }
    partNumberMarker = String(response.NextPartNumberMarker)
  }

  return parts
}

/**
 * Build a fallback object URL for when the SDK omits `Location` on multipart
 * completion. For a custom `S3_CONFIG.endpoint` it matches the configured
 * addressing mode — path-style for MinIO/Ceph (`forcePathStyle`), virtual-hosted
 * (bucket as a subdomain) for R2 and friends. Falls back to the AWS
 * virtual-hosted host when no custom endpoint is set.
 *
 * The key is percent-encoded per path segment (preserving `/` separators) so
 * keys containing spaces or reserved characters still yield a valid URL.
 */
function buildObjectFallbackUrl(bucket: string, region: string, key: string): string {
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  if (S3_CONFIG.endpoint) {
    const base = S3_CONFIG.endpoint.replace(/\/+$/, '')
    if (S3_CONFIG.forcePathStyle) {
      return `${base}/${bucket}/${encodedKey}`
    }
    const url = new URL(base)
    url.hostname = `${bucket}.${url.hostname}`
    return `${url.origin}/${encodedKey}`
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`
}

function isCompletedS3UploadRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { name?: unknown; code?: unknown; Code?: unknown }
  return (
    record.name === 'NoSuchUpload' ||
    record.code === 'NoSuchUpload' ||
    record.Code === 'NoSuchUpload'
  )
}

function isS3CreateConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as {
    name?: unknown
    code?: unknown
    Code?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  return (
    record.name === 'PreconditionFailed' ||
    record.code === 'PreconditionFailed' ||
    record.Code === 'PreconditionFailed' ||
    record.$metadata?.httpStatusCode === 412
  )
}

/**
 * Complete multipart upload for S3
 */
export async function completeS3MultipartUpload(
  key: string,
  uploadId: string,
  parts: S3MultipartPart[],
  customConfig?: S3Config,
  completionPolicy: MultipartCompletionPolicy = 'create-only'
): Promise<{ location: string; path: string; key: string }> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const command = new CompleteMultipartUploadCommand({
    Bucket: config.bucket,
    Key: key,
    UploadId: uploadId,
    ...(completionPolicy === 'replace' ? {} : { IfNoneMatch: '*' }),
    MultipartUpload: {
      Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
    },
  })

  let location: string | undefined
  try {
    const response = await s3Client.send(command)
    location = response.Location
  } catch (error) {
    const canReuseExisting = completionPolicy === 'reuse-existing' && isS3CreateConflict(error)
    if (
      (!isCompletedS3UploadRetry(error) && !canReuseExisting) ||
      !(await headS3Object(key, config))
    ) {
      throw error
    }
  }
  location ||= buildObjectFallbackUrl(config.bucket, config.region, key)
  const path = `/api/files/serve/${encodeURIComponent(key)}`

  return {
    location,
    path,
    key,
  }
}

/**
 * Abort multipart upload for S3
 */
export async function abortS3MultipartUpload(
  key: string,
  uploadId: string,
  customConfig?: S3Config
): Promise<void> {
  const config = customConfig || { bucket: S3_KB_CONFIG.bucket, region: S3_KB_CONFIG.region }
  const s3Client = getS3Client()

  const command = new AbortMultipartUploadCommand({
    Bucket: config.bucket,
    Key: key,
    UploadId: uploadId,
  })

  await s3Client.send(command)
}
