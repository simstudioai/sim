import type { Readable } from 'node:stream'
import { randomBytes } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import {
  getStorageConfig,
  USE_BLOB_STORAGE,
  USE_GCS_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'
import type { AzureMultipartPart, BlobConfig } from '@/lib/uploads/providers/blob/types'
import type { GcsConfig, GcsMultipartPart } from '@/lib/uploads/providers/gcs/types'
import type { S3Config, S3MultipartPart } from '@/lib/uploads/providers/s3/types'
import type {
  DeleteFileOptions,
  DownloadFileOptions,
  FileInfo,
  GeneratePresignedUrlOptions,
  PresignedUrlResponse,
  StorageConfig,
  StorageContext,
  UploadFileOptions,
} from '@/lib/uploads/shared/types'
import {
  sanitizeFileKey,
  sanitizeFilenameForMetadata,
  sanitizeStorageMetadata,
} from '@/lib/uploads/utils/file-utils'

const logger = createLogger('StorageService')

/**
 * Create a Blob config from StorageConfig
 * @throws Error if required properties are missing
 */
function createBlobConfig(config: StorageConfig): BlobConfig {
  if (!config.containerName) {
    throw new Error('Blob configuration missing required property: containerName')
  }

  if (!config.connectionString && !(config.accountName && config.accountKey)) {
    throw new Error(
      'Blob configuration missing authentication: either connectionString or both accountName and accountKey must be provided'
    )
  }

  return {
    containerName: config.containerName,
    accountName: config.accountName,
    accountKey: config.accountKey,
    connectionString: config.connectionString,
  }
}

/**
 * Create an S3 config from StorageConfig
 * @throws Error if required properties are missing
 */
function createS3Config(config: StorageConfig): S3Config {
  if (!config.bucket || !config.region) {
    throw new Error('S3 configuration missing required properties: bucket and region')
  }

  return {
    bucket: config.bucket,
    region: config.region,
  }
}

/**
 * Create a GCS config from StorageConfig
 * @throws Error if required properties are missing
 */
function createGcsConfig(config: StorageConfig): GcsConfig {
  if (!config.bucket) {
    throw new Error('GCS configuration missing required property: bucket')
  }

  return {
    bucket: config.bucket,
  }
}

/**
 * Insert file metadata into the database
 */
async function insertFileMetadataHelper(
  key: string,
  metadata: Record<string, string>,
  context: StorageContext,
  fileName: string,
  contentType: string,
  fileSize: number
): Promise<void> {
  const { insertFileMetadata } = await import('../server/metadata')
  await insertFileMetadata({
    key,
    userId: metadata.userId,
    workspaceId: metadata.workspaceId || null,
    folderId: metadata.folderId || null,
    context,
    originalName: metadata.originalName || fileName,
    contentType,
    size: fileSize,
  })
}

/**
 * Upload a file to the configured storage provider with context-aware configuration
 */
export async function uploadFile(options: UploadFileOptions): Promise<FileInfo> {
  const {
    file,
    fileName,
    contentType,
    context,
    preserveKey,
    customKey,
    metadata,
    persistMetadata = true,
  } = options

  logger.info(`Uploading file to ${context} storage: ${fileName}`)

  const config = getStorageConfig(context)

  const keyToUse = customKey || fileName

  if (USE_BLOB_STORAGE) {
    const { uploadToBlob } = await import('@/lib/uploads/providers/blob/client')
    const uploadResult = await uploadToBlob(
      file,
      keyToUse,
      contentType,
      createBlobConfig(config),
      file.length,
      preserveKey,
      metadata
    )

    if (metadata && persistMetadata) {
      await insertFileMetadataHelper(
        uploadResult.key,
        metadata,
        context,
        fileName,
        contentType,
        file.length
      )
    }

    return uploadResult
  }

  if (USE_S3_STORAGE) {
    const { uploadToS3 } = await import('@/lib/uploads/providers/s3/client')
    const uploadResult = await uploadToS3(
      file,
      keyToUse,
      contentType,
      createS3Config(config),
      file.length,
      preserveKey,
      metadata
    )

    if (metadata && persistMetadata) {
      await insertFileMetadataHelper(
        uploadResult.key,
        metadata,
        context,
        fileName,
        contentType,
        file.length
      )
    }

    return uploadResult
  }

  if (USE_GCS_STORAGE) {
    const { uploadToGcs } = await import('@/lib/uploads/providers/gcs/client')
    const uploadResult = await uploadToGcs(
      file,
      keyToUse,
      contentType,
      createGcsConfig(config),
      file.length,
      preserveKey,
      metadata
    )

    if (metadata && persistMetadata) {
      await insertFileMetadataHelper(
        uploadResult.key,
        metadata,
        context,
        fileName,
        contentType,
        file.length
      )
    }

    return uploadResult
  }

  const { writeFile, mkdir } = await import('fs/promises')
  const { join, dirname } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const storageKey = keyToUse
  const safeKey = sanitizeFileKey(keyToUse) // Validates and preserves path structure
  const filesystemPath = join(UPLOAD_DIR_SERVER, safeKey)

  await mkdir(dirname(filesystemPath), { recursive: true })

  await writeFile(filesystemPath, file)

  if (metadata && persistMetadata) {
    await insertFileMetadataHelper(
      storageKey,
      metadata,
      context,
      fileName,
      contentType,
      file.length
    )
  }

  return {
    path: `/api/files/serve/${storageKey}`,
    key: storageKey,
    name: fileName,
    size: file.length,
    type: contentType,
  }
}

/** Part size for streaming multipart uploads. ≥ S3's 5MB minimum (all but the last part). */
const MULTIPART_PART_SIZE = 8 * 1024 * 1024
/** Max parts uploading concurrently — caps in-flight memory at ~`this × PART_SIZE`. */
const MULTIPART_MAX_INFLIGHT = 4

/**
 * Streaming upload sink. The caller `write`s chunks (CSV rows, etc.) and `complete`s;
 * the implementation buffers into ≥5MB parts and uploads them with bounded concurrency,
 * so peak memory stays ~`MULTIPART_MAX_INFLIGHT × MULTIPART_PART_SIZE` regardless of total
 * size. A payload that never crosses one part takes a plain single-shot PutObject.
 */
export interface MultipartUploadHandle {
  write(chunk: Buffer | string): Promise<void>
  complete(): Promise<{ key: string; size: number }>
  abort(): Promise<void>
}

interface MultipartBackend {
  uploadPart(partNumber: number, body: Buffer): Promise<void>
  finish(): Promise<void>
  abort(): Promise<void>
}

async function createS3Backend(
  key: string,
  config: S3Config,
  contentType: string,
  purpose: string
): Promise<MultipartBackend> {
  const {
    initiateS3MultipartUpload,
    uploadS3Part,
    completeS3MultipartUpload,
    abortS3MultipartUpload,
  } = await import('@/lib/uploads/providers/s3/client')
  const { uploadId } = await initiateS3MultipartUpload({
    fileName: key,
    contentType,
    fileSize: 0,
    customConfig: config,
    customKey: key,
    purpose,
  })
  const parts: S3MultipartPart[] = []
  return {
    async uploadPart(partNumber, body) {
      parts.push(await uploadS3Part(key, uploadId, partNumber, body, config))
    },
    finish: () => completeS3MultipartUpload(key, uploadId, parts, config).then(() => undefined),
    abort: () => abortS3MultipartUpload(key, uploadId, config),
  }
}

async function createBlobBackend(
  key: string,
  config: BlobConfig,
  contentType: string
): Promise<MultipartBackend> {
  const { stageBlobPart, commitBlobBlockList, abortMultipartUpload } = await import(
    '@/lib/uploads/providers/blob/client'
  )
  const parts: AzureMultipartPart[] = []
  return {
    async uploadPart(partNumber, body) {
      parts.push(await stageBlobPart(key, partNumber, body, config))
    },
    finish: () => commitBlobBlockList(key, parts, contentType, config),
    abort: () => abortMultipartUpload(key, config),
  }
}

async function createGcsBackend(
  key: string,
  config: GcsConfig,
  contentType: string,
  purpose: string
): Promise<MultipartBackend> {
  const {
    initiateGcsMultipartUpload,
    uploadGcsPart,
    completeGcsMultipartUpload,
    abortGcsMultipartUpload,
  } = await import('@/lib/uploads/providers/gcs/client')
  const { uploadId } = await initiateGcsMultipartUpload({
    fileName: key,
    contentType,
    fileSize: 0,
    customConfig: config,
    customKey: key,
    purpose,
  })
  const parts: GcsMultipartPart[] = []
  return {
    async uploadPart(partNumber, body) {
      parts.push(await uploadGcsPart(key, uploadId, partNumber, body, config))
    },
    finish: () => completeGcsMultipartUpload(key, uploadId, parts, config).then(() => undefined),
    abort: () => abortGcsMultipartUpload(key, uploadId, config),
  }
}

/**
 * Open a streaming multipart upload to the configured provider. On the local
 * filesystem provider (and for any payload smaller than one part) the bytes are
 * buffered and written via a single {@link uploadFile} on `complete`.
 */
export async function createMultipartUpload(options: {
  key: string
  context: StorageContext
  contentType: string
}): Promise<MultipartUploadHandle> {
  const { key, context, contentType } = options
  const config = getStorageConfig(context)
  const cloud = hasCloudStorage()

  let backend: MultipartBackend | null = null
  // Accumulate writes as references, not a growing buffer — concatenating only when a part fills
  // (or on complete) keeps total copying ~O(bytes) instead of O(bytes × writes).
  let pendingChunks: Buffer[] = []
  let pendingBytes = 0
  let totalBytes = 0
  let partNumber = 0
  let aborted = false
  let firstError: unknown
  const inflight = new Set<Promise<void>>()

  /** Merge the accumulated chunks into one ArrayBuffer-backed buffer (which `uploadFile` expects). */
  const drainPending = (): Buffer<ArrayBuffer> => Buffer.concat(pendingChunks, pendingBytes)

  const ensureBackend = async (): Promise<MultipartBackend> => {
    if (!backend) {
      if (USE_BLOB_STORAGE) {
        backend = await createBlobBackend(key, createBlobConfig(config), contentType)
      } else if (USE_GCS_STORAGE) {
        backend = await createGcsBackend(key, createGcsConfig(config), contentType, context)
      } else {
        backend = await createS3Backend(key, createS3Config(config), contentType, context)
      }
    }
    return backend
  }

  const dispatchPart = async (body: Buffer): Promise<void> => {
    // Bound concurrency: wait for a free slot before starting another part.
    while (inflight.size >= MULTIPART_MAX_INFLIGHT) await Promise.race(inflight)
    if (firstError) throw firstError
    const be = await ensureBackend()
    const partNo = ++partNumber
    const p = be
      .uploadPart(partNo, body)
      .catch((err) => {
        firstError ??= err
      })
      .finally(() => {
        inflight.delete(p)
      })
    inflight.add(p)
  }

  const abort = async (): Promise<void> => {
    aborted = true
    await Promise.allSettled(inflight)
    if (backend) await backend.abort().catch(() => {})
  }

  return {
    async write(chunk) {
      if (aborted) throw new Error('Multipart upload already aborted')
      if (firstError) throw firstError
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      totalBytes += buf.length
      pendingChunks.push(buf)
      pendingBytes += buf.length
      // Local storage has no multipart concept — accumulate and write once on complete.
      if (!cloud) return
      while (pendingBytes >= MULTIPART_PART_SIZE) {
        const merged = drainPending()
        const part = merged.subarray(0, MULTIPART_PART_SIZE)
        const rest = merged.subarray(MULTIPART_PART_SIZE)
        pendingChunks = rest.length ? [rest] : []
        pendingBytes = rest.length
        await dispatchPart(part)
      }
    },
    async complete() {
      try {
        if (!backend) {
          // Never crossed one part (or local provider): single-shot upload.
          await uploadFile({
            file: drainPending(),
            fileName: key,
            contentType,
            context,
            preserveKey: true,
            customKey: key,
          })
          return { key, size: totalBytes }
        }
        if (pendingBytes > 0) await dispatchPart(drainPending())
        await Promise.all(inflight)
        if (firstError) throw firstError
        await backend.finish()
        return { key, size: totalBytes }
      } catch (err) {
        await abort()
        throw err
      }
    },
    abort,
  }
}

/**
 * Download a file from the configured storage provider
 */
export async function downloadFile(options: DownloadFileOptions): Promise<Buffer> {
  const { key, context, maxBytes } = options

  if (context) {
    const config = getStorageConfig(context)

    if (USE_BLOB_STORAGE) {
      const { downloadFromBlob } = await import('@/lib/uploads/providers/blob/client')
      const blobConfig = createBlobConfig(config)
      return maxBytes === undefined
        ? downloadFromBlob(key, blobConfig)
        : downloadFromBlob(key, blobConfig, maxBytes)
    }

    if (USE_S3_STORAGE) {
      const { downloadFromS3 } = await import('@/lib/uploads/providers/s3/client')
      const s3Config = createS3Config(config)
      return maxBytes === undefined
        ? downloadFromS3(key, s3Config)
        : downloadFromS3(key, s3Config, maxBytes)
    }

    if (USE_GCS_STORAGE) {
      const { downloadFromGcs } = await import('@/lib/uploads/providers/gcs/client')
      const gcsConfig = createGcsConfig(config)
      return maxBytes === undefined
        ? downloadFromGcs(key, gcsConfig)
        : downloadFromGcs(key, gcsConfig, maxBytes)
    }
  }

  const { readFile, stat } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  if (maxBytes !== undefined) {
    const fileStats = await stat(filePath)
    assertKnownSizeWithinLimit(fileStats.size, maxBytes, 'storage download')
  }

  return readFile(filePath)
}

/**
 * Stream a file out of the configured storage provider without buffering it in memory.
 * The caller MUST fully consume or `destroy()` the returned stream. Used by the large-CSV
 * import worker so a multi-hundred-MB file is never held resident.
 */
export async function downloadFileStream(options: {
  key: string
  context: StorageContext
}): Promise<Readable> {
  const { key, context } = options
  const config = getStorageConfig(context)

  if (USE_BLOB_STORAGE) {
    const { downloadFromBlobStream } = await import('@/lib/uploads/providers/blob/client')
    return downloadFromBlobStream(key, createBlobConfig(config))
  }

  if (USE_S3_STORAGE) {
    const { downloadFromS3Stream } = await import('@/lib/uploads/providers/s3/client')
    return downloadFromS3Stream(key, createS3Config(config))
  }

  if (USE_GCS_STORAGE) {
    const { downloadFromGcsStream } = await import('@/lib/uploads/providers/gcs/client')
    return downloadFromGcsStream(key, createGcsConfig(config))
  }

  const { createReadStream } = await import('fs')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')
  return createReadStream(join(UPLOAD_DIR_SERVER, sanitizeFileKey(key)))
}

/**
 * Delete a file from the configured storage provider
 */
export async function deleteFile(options: DeleteFileOptions): Promise<void> {
  const { key, context } = options

  if (context) {
    const config = getStorageConfig(context)

    if (USE_BLOB_STORAGE) {
      const { deleteFromBlob } = await import('@/lib/uploads/providers/blob/client')
      return deleteFromBlob(key, createBlobConfig(config))
    }

    if (USE_S3_STORAGE) {
      const { deleteFromS3 } = await import('@/lib/uploads/providers/s3/client')
      return deleteFromS3(key, createS3Config(config))
    }

    if (USE_GCS_STORAGE) {
      const { deleteFromGcs } = await import('@/lib/uploads/providers/gcs/client')
      return deleteFromGcs(key, createGcsConfig(config))
    }
  }

  const { unlink } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  await unlink(filePath)
}

/** AWS SDK v3 silently caps HTTP connections at 50/endpoint — stay well under. */
const PER_FILE_DELETE_CONCURRENCY = 25

/**
 * Bulk delete via the provider's native multi-object API when available
 * (S3 `DeleteObjects`), else bounded-concurrency per-file. All keys must
 * share `context`. Idempotent on missing keys.
 */
export async function deleteFiles(
  keys: string[],
  context: StorageContext
): Promise<{ deleted: number; failed: Array<{ key: string; error: string }> }> {
  if (keys.length === 0) return { deleted: 0, failed: [] }

  const config = getStorageConfig(context)

  if (USE_S3_STORAGE) {
    const { deleteManyFromS3 } = await import('@/lib/uploads/providers/s3/client')
    const { failed } = await deleteManyFromS3(keys, createS3Config(config))
    return { deleted: keys.length - failed.length, failed }
  }

  const failed: Array<{ key: string; error: string }> = []
  let cursor = 0
  const runWorker = async (): Promise<void> => {
    while (cursor < keys.length) {
      const idx = cursor++
      const key = keys[idx]
      try {
        await deleteFile({ key, context })
      } catch (error) {
        failed.push({ key, error: getErrorMessage(error) })
      }
    }
  }

  const workerCount = Math.min(PER_FILE_DELETE_CONCURRENCY, keys.length)
  await Promise.all(Array.from({ length: workerCount }, runWorker))

  return { deleted: keys.length - failed.length, failed }
}

/**
 * Check whether an object exists in the configured cloud storage provider.
 * Returns object size and content-type when present, or null when missing.
 * Throws on errors other than "not found". For local filesystem, returns null.
 */
export async function headObject(
  key: string,
  context: StorageContext
): Promise<{ size: number; contentType?: string } | null> {
  const config = getStorageConfig(context)

  if (USE_BLOB_STORAGE) {
    const { headBlobObject } = await import('@/lib/uploads/providers/blob/client')
    return headBlobObject(key, createBlobConfig(config))
  }

  if (USE_S3_STORAGE) {
    const { headS3Object } = await import('@/lib/uploads/providers/s3/client')
    return headS3Object(key, createS3Config(config))
  }

  if (USE_GCS_STORAGE) {
    const { headGcsObject } = await import('@/lib/uploads/providers/gcs/client')
    return headGcsObject(key, createGcsConfig(config))
  }

  return null
}

/**
 * Generate a presigned URL for direct file upload
 */
export async function generatePresignedUploadUrl(
  options: GeneratePresignedUrlOptions
): Promise<PresignedUrlResponse> {
  const {
    fileName,
    contentType,
    fileSize,
    context,
    userId,
    expirationSeconds = 3600,
    metadata = {},
    customKey,
  } = options

  const allMetadata = {
    ...metadata,
    originalName: fileName,
    uploadedAt: new Date().toISOString(),
    purpose: context,
    ...(userId && { userId }),
  }

  const config = getStorageConfig(context)

  let key: string
  if (customKey) {
    key = customKey
  } else {
    const timestamp = Date.now()
    const uniqueId = randomBytes(8).toString('hex')
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    key = `${context}/${timestamp}-${uniqueId}-${safeFileName}`
  }

  if (USE_S3_STORAGE) {
    return generateS3PresignedUrl(
      key,
      contentType,
      fileSize,
      allMetadata,
      config,
      expirationSeconds
    )
  }

  if (USE_BLOB_STORAGE) {
    return generateBlobPresignedUrl(key, contentType, allMetadata, config, expirationSeconds)
  }

  if (USE_GCS_STORAGE) {
    return generateGcsPresignedUrl(key, contentType, allMetadata, config, expirationSeconds)
  }

  throw new Error('Cloud storage not configured. Cannot generate presigned URL for local storage.')
}

/**
 * Generate presigned URL for GCS
 */
async function generateGcsPresignedUrl(
  key: string,
  contentType: string,
  metadata: Record<string, string>,
  config: StorageConfig,
  expirationSeconds: number
): Promise<PresignedUrlResponse> {
  const { getGcsPresignedUploadUrl } = await import('@/lib/uploads/providers/gcs/client')

  const { url, signedHeaders } = await getGcsPresignedUploadUrl(
    key,
    contentType,
    metadata,
    createGcsConfig(config),
    expirationSeconds
  )

  return {
    url,
    key,
    uploadHeaders: signedHeaders,
  }
}

/**
 * Generate presigned URL for S3
 */
async function generateS3PresignedUrl(
  key: string,
  contentType: string,
  fileSize: number,
  metadata: Record<string, string>,
  config: { bucket?: string; region?: string },
  expirationSeconds: number
): Promise<PresignedUrlResponse> {
  const { getS3Client } = await import('@/lib/uploads/providers/s3/client')
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

  if (!config.bucket || !config.region) {
    throw new Error('S3 configuration missing bucket or region')
  }

  const sanitizedMetadata = sanitizeStorageMetadata(metadata, 2000)
  if (sanitizedMetadata.originalName) {
    sanitizedMetadata.originalName = sanitizeFilenameForMetadata(sanitizedMetadata.originalName)
  }

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: fileSize,
    Metadata: sanitizedMetadata,
  })

  const presignedUrl = await getSignedUrl(getS3Client(), command, { expiresIn: expirationSeconds })

  return {
    url: presignedUrl,
    key,
  }
}

/**
 * Generate presigned URL for Azure Blob
 */
async function generateBlobPresignedUrl(
  key: string,
  contentType: string,
  metadata: Record<string, string>,
  config: {
    containerName?: string
    accountName?: string
    accountKey?: string
    connectionString?: string
  },
  expirationSeconds: number
): Promise<PresignedUrlResponse> {
  const { getBlobServiceClient, parseConnectionString } = await import(
    '@/lib/uploads/providers/blob/client'
  )
  const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
    await import('@azure/storage-blob')

  if (!config.containerName) {
    throw new Error('Blob configuration missing container name')
  }

  const blobServiceClient = await getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(config.containerName)
  const blobClient = containerClient.getBlockBlobClient(key)

  const startsOn = new Date()
  const expiresOn = new Date(startsOn.getTime() + expirationSeconds * 1000)

  let accountName = config.accountName
  let accountKey = config.accountKey
  if ((!accountName || !accountKey) && config.connectionString) {
    ;({ accountName, accountKey } = parseConnectionString(config.connectionString))
  }

  if (!accountName || !accountKey) {
    throw new Error(
      'Azure Blob SAS generation requires accountName/accountKey or a connectionString'
    )
  }

  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: config.containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse('w'), // write permission for upload
      startsOn,
      expiresOn,
    },
    sharedKeyCredential
  ).toString()

  return {
    url: `${blobClient.url}?${sasToken}`,
    key,
    uploadHeaders: {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-blob-content-type': contentType,
      ...Object.entries(metadata).reduce(
        (acc, [k, v]) => {
          acc[`x-ms-meta-${k}`] = encodeURIComponent(v)
          return acc
        },
        {} as Record<string, string>
      ),
    },
  }
}

/**
 * Generate multiple presigned URLs at once (batch operation)
 */
export async function generateBatchPresignedUploadUrls(
  files: Array<{
    fileName: string
    contentType: string
    fileSize: number
  }>,
  context: StorageContext,
  userId?: string,
  expirationSeconds?: number
): Promise<PresignedUrlResponse[]> {
  const results: PresignedUrlResponse[] = []

  for (const file of files) {
    const result = await generatePresignedUploadUrl({
      fileName: file.fileName,
      contentType: file.contentType,
      fileSize: file.fileSize,
      context,
      userId,
      expirationSeconds,
    })
    results.push(result)
  }

  return results
}

/**
 * Generate a presigned URL for downloading/accessing an existing file
 */
export async function generatePresignedDownloadUrl(
  key: string,
  context: StorageContext,
  expirationSeconds = 3600
): Promise<string> {
  const config = getStorageConfig(context)

  if (USE_S3_STORAGE) {
    const { getPresignedUrlWithConfig } = await import('@/lib/uploads/providers/s3/client')
    return getPresignedUrlWithConfig(key, createS3Config(config), expirationSeconds)
  }

  if (USE_BLOB_STORAGE) {
    const { getPresignedUrlWithConfig } = await import('@/lib/uploads/providers/blob/client')
    return getPresignedUrlWithConfig(key, createBlobConfig(config), expirationSeconds)
  }

  if (USE_GCS_STORAGE) {
    const { getPresignedUrlWithConfig } = await import('@/lib/uploads/providers/gcs/client')
    return getPresignedUrlWithConfig(key, createGcsConfig(config), expirationSeconds)
  }

  const { getBaseUrl } = await import('@/lib/core/utils/urls')
  const baseUrl = getBaseUrl()
  return `${baseUrl}/api/files/serve/${encodeURIComponent(key)}`
}

/**
 * Check if cloud storage is available
 */
export function hasCloudStorage(): boolean {
  return USE_BLOB_STORAGE || USE_S3_STORAGE || USE_GCS_STORAGE
}

/**
 * Get S3 bucket and key information for a storage key
 * Useful for services that need direct S3 access (e.g., AWS Textract async)
 */
export function getS3InfoForKey(
  key: string,
  context: StorageContext
): { bucket: string; key: string } {
  if (!USE_S3_STORAGE) {
    throw new Error('S3 storage is not configured. Cannot retrieve S3 info for key.')
  }

  const config = getStorageConfig(context)

  if (!config.bucket) {
    throw new Error(`S3 bucket not configured for context: ${context}`)
  }

  return {
    bucket: config.bucket,
    key,
  }
}
