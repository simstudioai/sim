import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { readNodeStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'
import {
  getStorageConfig,
  USE_BLOB_STORAGE,
  USE_GCS_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'
import { LOCAL_UPLOAD_METADATA_SUFFIX } from '@/lib/uploads/core/storage-key'
import type { AzureMultipartPart, BlobConfig } from '@/lib/uploads/providers/blob/types'
import type { GcsConfig, GcsMultipartPart } from '@/lib/uploads/providers/gcs/types'
import type { S3Config, S3MultipartPart } from '@/lib/uploads/providers/s3/types'
import type {
  DeleteFileOptions,
  DownloadFileOptions,
  FileInfo,
  MultipartCompletionPolicy,
  StorageConfig,
  StorageContext,
  StoredObjectInfo,
  UploadFileOptions,
} from '@/lib/uploads/shared/types'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('StorageService')

/**
 * Create a Blob config from StorageConfig
 * @throws Error if required properties are missing
 */
export function createBlobConfig(config: StorageConfig): BlobConfig {
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
export function createS3Config(config: StorageConfig): S3Config {
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
export function createGcsConfig(config: StorageConfig): GcsConfig {
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
  fileSize: number,
  uploadId?: string
): Promise<void> {
  const { insertFileMetadata, insertImmutableFileMetadata } = await import(
    '@/lib/uploads/server/metadata'
  )
  const insertMetadata =
    context === 'knowledge-base' ? insertImmutableFileMetadata : insertFileMetadata
  try {
    await insertMetadata({
      key,
      userId: metadata.userId,
      workspaceId: metadata.workspaceId || null,
      organizationId: metadata.organizationId || null,
      folderId: metadata.folderId || null,
      context,
      originalName: metadata.originalName || fileName,
      contentType,
      size: fileSize,
    })
  } catch (error) {
    if (uploadId) {
      try {
        const { cleanupUnboundKnowledgeUpload } = await import(
          '@/lib/uploads/core/knowledge-upload-cleanup'
        )
        await cleanupUnboundKnowledgeUpload(key, uploadId)
      } catch (cleanupError) {
        logger.error('Failed to clean up an unbound knowledge upload', {
          key,
          uploadId,
          error: cleanupError,
        })
      }
    }
    throw error
  }
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
  const uploadId =
    context === 'knowledge-base' && metadata && persistMetadata ? generateId() : undefined
  const objectMetadata = uploadId ? { ...metadata, uploadId } : metadata

  if (USE_BLOB_STORAGE) {
    const { uploadToBlob } = await import('@/lib/uploads/providers/blob/client')
    const uploadResult = await uploadToBlob(
      file,
      keyToUse,
      contentType,
      createBlobConfig(config),
      file.length,
      preserveKey,
      objectMetadata,
      Boolean(uploadId)
    )

    if (metadata && persistMetadata) {
      await insertFileMetadataHelper(
        uploadResult.key,
        metadata,
        context,
        fileName,
        contentType,
        file.length,
        uploadId
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
      objectMetadata,
      Boolean(uploadId)
    )

    if (metadata && persistMetadata) {
      await insertFileMetadataHelper(
        uploadResult.key,
        metadata,
        context,
        fileName,
        contentType,
        file.length,
        uploadId
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
      objectMetadata,
      Boolean(uploadId)
    )

    if (metadata && persistMetadata) {
      await insertFileMetadataHelper(
        uploadResult.key,
        metadata,
        context,
        fileName,
        contentType,
        file.length,
        uploadId
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

  if (uploadId) {
    const { writeLocalPutObject } = await import('@/lib/uploads/upload-session/provider')
    await writeLocalPutObject({
      uploadId,
      key: storageKey,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(file)
          controller.close()
        },
      }),
      expectedSize: file.length,
      contentType,
      metadata: objectMetadata ?? {},
    })
  } else {
    await writeFile(filesystemPath, file)
  }

  if (metadata && persistMetadata) {
    await insertFileMetadataHelper(
      storageKey,
      metadata,
      context,
      fileName,
      contentType,
      file.length,
      uploadId
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
  purpose: string,
  completionPolicy: MultipartCompletionPolicy
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
    finish: () =>
      completeS3MultipartUpload(key, uploadId, parts, config, completionPolicy).then(
        () => undefined
      ),
    abort: () => abortS3MultipartUpload(key, uploadId, config),
  }
}

async function createBlobBackend(
  key: string,
  config: BlobConfig,
  contentType: string,
  completionPolicy: MultipartCompletionPolicy
): Promise<MultipartBackend> {
  const { initiateMultipartUpload, stageBlobPart, commitBlobBlockList, abortMultipartUpload } =
    await import('@/lib/uploads/providers/blob/client')
  const { uploadId } = await initiateMultipartUpload({
    fileName: key,
    contentType,
    fileSize: 0,
    customConfig: config,
    customKey: key,
  })
  const parts: AzureMultipartPart[] = []
  return {
    async uploadPart(partNumber, body) {
      parts.push(await stageBlobPart(key, partNumber, body, config))
    },
    finish: () => commitBlobBlockList(key, uploadId, parts, contentType, config, completionPolicy),
    abort: () => abortMultipartUpload(key, uploadId, config),
  }
}

async function createGcsBackend(
  key: string,
  config: GcsConfig,
  contentType: string,
  purpose: string,
  completionPolicy: MultipartCompletionPolicy
): Promise<MultipartBackend> {
  const {
    initiateGcsMultipartUpload,
    uploadGcsPart,
    completeGcsMultipartUpload,
    abortGcsMultipartUpload,
  } = await import('@/lib/uploads/providers/gcs/client')
  const { uploadId, key: uploadKey } = await initiateGcsMultipartUpload({
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
      parts.push(await uploadGcsPart(uploadKey, uploadId, partNumber, body, config))
    },
    finish: () =>
      completeGcsMultipartUpload(uploadKey, uploadId, parts, config, completionPolicy).then(
        () => undefined
      ),
    abort: () => abortGcsMultipartUpload(uploadKey, uploadId, config),
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
  completionPolicy: MultipartCompletionPolicy
}): Promise<MultipartUploadHandle> {
  const { key, context, contentType, completionPolicy } = options
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
        backend = await createBlobBackend(
          key,
          createBlobConfig(config),
          contentType,
          completionPolicy
        )
      } else if (USE_GCS_STORAGE) {
        backend = await createGcsBackend(
          key,
          createGcsConfig(config),
          contentType,
          context,
          completionPolicy
        )
      } else {
        backend = await createS3Backend(
          key,
          createS3Config(config),
          contentType,
          context,
          completionPolicy
        )
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
  const { key, context, maxBytes, signal } = options
  signal?.throwIfAborted()

  if (context) {
    const config = getStorageConfig(context)

    if (USE_BLOB_STORAGE) {
      const { downloadFromBlob } = await import('@/lib/uploads/providers/blob/client')
      const blobConfig = createBlobConfig(config)
      return downloadFromBlob(key, blobConfig, maxBytes, signal)
    }

    if (USE_S3_STORAGE) {
      const { downloadFromS3 } = await import('@/lib/uploads/providers/s3/client')
      const s3Config = createS3Config(config)
      return downloadFromS3(key, s3Config, maxBytes, signal)
    }

    if (USE_GCS_STORAGE) {
      const { downloadFromGcs } = await import('@/lib/uploads/providers/gcs/client')
      const gcsConfig = createGcsConfig(config)
      return downloadFromGcs(key, gcsConfig, maxBytes, signal)
    }
  }

  const { readFile } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  if (maxBytes !== undefined) {
    // Bounded as the bytes arrive, the way every cloud provider branch above reads.
    // Checking `stat` and then calling `readFile` describes the file only as of the
    // stat, so a caller that asked for a ceiling would still get whatever the file
    // became in between — and on a self-hosted deployment this is the same anonymous
    // share path the cloud branches serve.
    const { createReadStream } = await import('fs')
    const stream = createReadStream(filePath, signal ? { signal } : undefined)
    try {
      return await readNodeStreamToBufferWithLimit(stream, {
        maxBytes,
        label: 'storage download',
        signal,
      })
    } finally {
      stream.destroy()
    }
  }

  return readFile(filePath, signal ? { signal } : undefined)
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

  const { rm, unlink } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  await unlink(filePath)
  await rm(`${filePath}${LOCAL_UPLOAD_METADATA_SUFFIX}`, { force: true })
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
): Promise<StoredObjectInfo | null> {
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

  const { stat } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')
  try {
    const file = await stat(join(UPLOAD_DIR_SERVER, sanitizeFileKey(key)))
    return { size: file.size }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
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
