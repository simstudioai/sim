import { createLogger } from '@/lib/logs/console/logger'
import { getStorageConfig, USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/config'
import type { BlobConfig } from '@/lib/uploads/providers/blob/types'
import type { S3Config } from '@/lib/uploads/providers/s3/types'
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
  if (!config.containerName || !config.accountName) {
    throw new Error('Blob configuration missing required properties: containerName and accountName')
  }

  if (!config.connectionString && !config.accountKey) {
    throw new Error(
      'Blob configuration missing authentication: either connectionString or accountKey must be provided'
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
  const { file, fileName, contentType, context, preserveKey, customKey, metadata } = options

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

    if (metadata) {
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

    if (metadata) {
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

  if (metadata) {
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

/**
 * Download a file from the configured storage provider
 */
export async function downloadFile(options: DownloadFileOptions): Promise<Buffer> {
  const { key, context } = options

  if (context) {
    const config = getStorageConfig(context)

    if (USE_BLOB_STORAGE) {
      const { downloadFromBlob } = await import('@/lib/uploads/providers/blob/client')
      return downloadFromBlob(key, createBlobConfig(config))
    }

    if (USE_S3_STORAGE) {
      const { downloadFromS3 } = await import('@/lib/uploads/providers/s3/client')
      return downloadFromS3(key, createS3Config(config))
    }
  }

  const { readFile } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  return readFile(filePath)
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
  }

  const { unlink } = await import('fs/promises')
  const { join } = await import('path')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  await unlink(filePath)
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
  } = options

  const allMetadata = {
    ...metadata,
    originalName: fileName,
    uploadedAt: new Date().toISOString(),
    purpose: context,
    ...(userId && { userId }),
  }

  const config = getStorageConfig(context)

  const timestamp = Date.now()
  const uniqueId = Math.random().toString(36).substring(2, 9)
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const key = `${context}/${timestamp}-${uniqueId}-${safeFileName}`

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

  throw new Error('Cloud storage not configured. Cannot generate presigned URL for local storage.')
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
  const { getBlobServiceClient } = await import('@/lib/uploads/providers/blob/client')
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

  let sasToken: string

  if (config.accountName && config.accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(
      config.accountName,
      config.accountKey
    )
    sasToken = generateBlobSASQueryParameters(
      {
        containerName: config.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('w'), // write permission for upload
        startsOn,
        expiresOn,
      },
      sharedKeyCredential
    ).toString()
  } else {
    throw new Error('Azure Blob SAS generation requires accountName and accountKey')
  }

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

  const { getBaseUrl } = await import('@/lib/urls/utils')
  const baseUrl = getBaseUrl()
  return `${baseUrl}/api/files/serve/${encodeURIComponent(key)}`
}

/**
 * Check if cloud storage is available
 */
export function hasCloudStorage(): boolean {
  return USE_BLOB_STORAGE || USE_S3_STORAGE
}
