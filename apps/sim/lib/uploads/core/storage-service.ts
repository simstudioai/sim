import { createLogger } from '@/lib/logs/console/logger'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/core/setup'
import { getStorageConfig, type StorageContext } from './config-resolver'
import type { FileInfo } from './storage-client'

const logger = createLogger('StorageService')

export interface UploadFileOptions {
  file: Buffer
  fileName: string
  contentType: string
  context: StorageContext
  preserveKey?: boolean // Skip timestamp prefix (for workspace/execution files)
  customKey?: string // Provide exact key to use (overrides fileName)
  metadata?: Record<string, string>
}

export interface DownloadFileOptions {
  key: string
  context?: StorageContext
}

export interface DeleteFileOptions {
  key: string
  context?: StorageContext
}

export interface GeneratePresignedUrlOptions {
  fileName: string
  contentType: string
  fileSize: number
  context: StorageContext
  userId?: string
  expirationSeconds?: number
  metadata?: Record<string, string>
}

export interface PresignedUrlResponse {
  url: string
  key: string
  fields?: Record<string, string>
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
    const { uploadToBlob } = await import('../providers/blob/blob-client')
    const blobConfig = {
      containerName: config.containerName!,
      accountName: config.accountName!,
      accountKey: config.accountKey,
      connectionString: config.connectionString,
    }

    return uploadToBlob(file, keyToUse, contentType, blobConfig, file.length)
  }

  if (USE_S3_STORAGE) {
    const { uploadToS3 } = await import('../providers/s3/s3-client')
    const s3Config = {
      bucket: config.bucket!,
      region: config.region!,
    }

    return uploadToS3(file, keyToUse, contentType, s3Config, file.length, preserveKey)
  }

  logger.info('Using local file storage')
  const { writeFile } = await import('fs/promises')
  const { join } = await import('path')
  const { v4: uuidv4 } = await import('uuid')
  const { UPLOAD_DIR_SERVER } = await import('./setup.server')

  const safeKey = keyToUse.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.\./g, '')
  const uniqueKey = `${uuidv4()}-${safeKey}`
  const filePath = join(UPLOAD_DIR_SERVER, uniqueKey)

  try {
    await writeFile(filePath, file)
  } catch (error) {
    logger.error(`Failed to write file to local storage: ${fileName}`, error)
    throw new Error(
      `Failed to write file to local storage: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }

  return {
    path: `/api/files/serve/${uniqueKey}`,
    key: uniqueKey,
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

  logger.info(`Downloading file: ${key}${context ? ` (context: ${context})` : ''}`)

  if (context) {
    const config = getStorageConfig(context)

    if (USE_BLOB_STORAGE) {
      const { downloadFromBlob } = await import('../providers/blob/blob-client')
      const blobConfig = {
        containerName: config.containerName!,
        accountName: config.accountName!,
        accountKey: config.accountKey,
        connectionString: config.connectionString,
      }
      return downloadFromBlob(key, blobConfig)
    }

    if (USE_S3_STORAGE) {
      const { downloadFromS3 } = await import('../providers/s3/s3-client')
      const s3Config = {
        bucket: config.bucket!,
        region: config.region!,
      }
      return downloadFromS3(key, s3Config)
    }
  }

  const { downloadFile: defaultDownload } = await import('./storage-client')
  return defaultDownload(key)
}

/**
 * Delete a file from the configured storage provider
 */
export async function deleteFile(options: DeleteFileOptions): Promise<void> {
  const { key, context } = options

  logger.info(`Deleting file: ${key}${context ? ` (context: ${context})` : ''}`)

  if (context) {
    const config = getStorageConfig(context)

    if (USE_BLOB_STORAGE) {
      const { deleteFromBlob } = await import('../providers/blob/blob-client')
      const blobConfig = {
        containerName: config.containerName!,
        accountName: config.accountName!,
        accountKey: config.accountKey,
        connectionString: config.connectionString,
      }
      return deleteFromBlob(key, blobConfig)
    }

    if (USE_S3_STORAGE) {
      const { deleteFromS3 } = await import('../providers/s3/s3-client')
      const s3Config = {
        bucket: config.bucket!,
        region: config.region!,
      }
      return deleteFromS3(key, s3Config)
    }
  }

  const { deleteFile: defaultDelete } = await import('./storage-client')
  return defaultDelete(key)
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

  logger.info(`Generating presigned upload URL for ${context}: ${fileName}`)

  const allMetadata = {
    ...metadata,
    'original-filename': fileName,
    ...(userId && { 'user-id': userId }),
  }

  const config = getStorageConfig(context)

  const timestamp = Date.now()
  const uniqueId = Math.random().toString(36).substring(2, 9)
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  const key = `${timestamp}-${uniqueId}-${safeFileName}`

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
    return generateBlobPresignedUrl(
      key,
      contentType,
      fileSize,
      allMetadata,
      config,
      expirationSeconds
    )
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
  const { getS3Client } = await import('../providers/s3/s3-client')
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')

  if (!config.bucket || !config.region) {
    throw new Error('S3 configuration missing bucket or region')
  }

  const sanitizedMetadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const sanitizedKey = key
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    sanitizedMetadata[sanitizedKey] = value
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
  fileSize: number,
  metadata: Record<string, string>,
  config: {
    containerName?: string
    accountName?: string
    accountKey?: string
    connectionString?: string
  },
  expirationSeconds: number
): Promise<PresignedUrlResponse> {
  const { getBlobServiceClient } = await import('../providers/blob/blob-client')
  const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
    await import('@azure/storage-blob')

  if (!config.containerName) {
    throw new Error('Blob configuration missing container name')
  }

  const blobServiceClient = getBlobServiceClient()
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
        permissions: BlobSASPermissions.parse('cw'), // create, write
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
    fields: {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-blob-content-type': contentType,
      ...Object.entries(metadata).reduce(
        (acc, [k, v]) => {
          acc[`x-ms-meta-${k}`] = v
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
  logger.info(`Generating ${files.length} presigned upload URLs for ${context}`)

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
  logger.info(`Generating presigned download URL for ${context}: ${key}`)

  const config = getStorageConfig(context)

  if (USE_S3_STORAGE) {
    const { getPresignedUrlWithConfig } = await import('../providers/s3/s3-client')
    return getPresignedUrlWithConfig(
      key,
      {
        bucket: config.bucket!,
        region: config.region!,
      },
      expirationSeconds
    )
  }

  if (USE_BLOB_STORAGE) {
    const { getPresignedUrlWithConfig } = await import('../providers/blob/blob-client')
    return getPresignedUrlWithConfig(
      key,
      {
        containerName: config.containerName!,
        accountName: config.accountName!,
        accountKey: config.accountKey,
        connectionString: config.connectionString,
      },
      expirationSeconds
    )
  }

  return `/api/files/serve/${encodeURIComponent(key)}`
}

/**
 * Check if cloud storage is available
 */
export function hasCloudStorage(): boolean {
  return USE_BLOB_STORAGE || USE_S3_STORAGE
}

/**
 * Get the current storage provider name
 */
export function getStorageProviderName(): 'Azure Blob' | 'S3' | 'Local' {
  if (USE_BLOB_STORAGE) return 'Azure Blob'
  if (USE_S3_STORAGE) return 'S3'
  return 'Local'
}
