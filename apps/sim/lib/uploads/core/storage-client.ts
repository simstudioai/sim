import { createLogger } from '@/lib/logs/console/logger'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/config'
import type { BlobConfig } from '@/lib/uploads/providers/blob/types'
import type { S3Config } from '@/lib/uploads/providers/s3/types'
import type { FileInfo, StorageConfig } from '@/lib/uploads/shared/types'
import { sanitizeFileKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('StorageClient')

export type { FileInfo, StorageConfig } from '@/lib/uploads/shared/types'

/**
 * Validate and resolve local file path ensuring it's within the allowed directory
 * @param key File key/name
 * @param uploadDir Upload directory path
 * @returns Resolved file path
 * @throws Error if path is invalid or outside allowed directory
 */
async function validateLocalFilePath(key: string, uploadDir: string): Promise<string> {
  const { join, resolve, sep } = await import('path')

  const safeKey = sanitizeFileKey(key)
  const filePath = join(uploadDir, safeKey)

  const resolvedPath = resolve(filePath)
  const allowedDir = resolve(uploadDir)

  if (!resolvedPath.startsWith(allowedDir + sep) && resolvedPath !== allowedDir) {
    throw new Error('Invalid file path')
  }

  return filePath
}

/**
 * Upload a file to the configured storage provider
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo>

/**
 * Upload a file to the configured storage provider with custom configuration
 * @param file Buffer containing file data
 * @param fileName Original file name
 * @param contentType MIME type of the file
 * @param customConfig Custom storage configuration
 * @param size File size in bytes (optional, will use buffer length if not provided)
 * @returns Object with file information
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  customConfig: StorageConfig,
  size?: number
): Promise<FileInfo>

export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: StorageConfig | number,
  size?: number
): Promise<FileInfo> {
  if (USE_BLOB_STORAGE) {
    const { uploadToBlob } = await import('@/lib/uploads/providers/blob/client')
    if (typeof configOrSize === 'object') {
      if (!configOrSize.containerName || !configOrSize.accountName) {
        throw new Error(
          'Blob configuration missing required properties: containerName and accountName'
        )
      }
      if (!configOrSize.connectionString && !configOrSize.accountKey) {
        throw new Error(
          'Blob configuration missing authentication: either connectionString or accountKey must be provided'
        )
      }
      const blobConfig: BlobConfig = {
        containerName: configOrSize.containerName,
        accountName: configOrSize.accountName,
        accountKey: configOrSize.accountKey,
        connectionString: configOrSize.connectionString,
      }
      return uploadToBlob(file, fileName, contentType, blobConfig, size)
    }
    return uploadToBlob(file, fileName, contentType, configOrSize)
  }

  if (USE_S3_STORAGE) {
    const { uploadToS3 } = await import('@/lib/uploads/providers/s3/client')
    if (typeof configOrSize === 'object') {
      if (!configOrSize.bucket || !configOrSize.region) {
        throw new Error('S3 configuration missing required properties: bucket and region')
      }
      const s3Config: S3Config = {
        bucket: configOrSize.bucket,
        region: configOrSize.region,
      }
      return uploadToS3(file, fileName, contentType, s3Config, size)
    }
    return uploadToS3(file, fileName, contentType, configOrSize)
  }

  const { writeFile } = await import('fs/promises')
  const { join } = await import('path')
  const { v4: uuidv4 } = await import('uuid')
  const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/core/setup.server')

  const safeFileName = sanitizeFileKey(fileName)
  const uniqueKey = `${uuidv4()}-${safeFileName}`
  const filePath = join(UPLOAD_DIR_SERVER, uniqueKey)

  try {
    await writeFile(filePath, file)
  } catch (error) {
    logger.error(`Failed to write file to local storage: ${fileName}`, error)
    throw error
  }

  const fileSize = typeof configOrSize === 'number' ? configOrSize : size || file.length

  return {
    path: `/api/files/serve/${uniqueKey}`,
    key: uniqueKey,
    name: fileName,
    size: fileSize,
    type: contentType,
  }
}

/**
 * Download a file from the configured storage provider
 * @param key File key/name
 * @returns File buffer
 */
export async function downloadFile(key: string): Promise<Buffer>

/**
 * Download a file from the configured storage provider with custom configuration
 * @param key File key/name
 * @param customConfig Custom storage configuration
 * @returns File buffer
 */
export async function downloadFile(key: string, customConfig: StorageConfig): Promise<Buffer>

export async function downloadFile(key: string, customConfig?: StorageConfig): Promise<Buffer> {
  if (USE_BLOB_STORAGE) {
    const { downloadFromBlob } = await import('@/lib/uploads/providers/blob/client')
    if (customConfig) {
      if (!customConfig.containerName || !customConfig.accountName) {
        throw new Error(
          'Blob configuration missing required properties: containerName and accountName'
        )
      }
      if (!customConfig.connectionString && !customConfig.accountKey) {
        throw new Error(
          'Blob configuration missing authentication: either connectionString or accountKey must be provided'
        )
      }
      const blobConfig: BlobConfig = {
        containerName: customConfig.containerName,
        accountName: customConfig.accountName,
        accountKey: customConfig.accountKey,
        connectionString: customConfig.connectionString,
      }
      return downloadFromBlob(key, blobConfig)
    }
    return downloadFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    const { downloadFromS3 } = await import('@/lib/uploads/providers/s3/client')
    if (customConfig) {
      if (!customConfig.bucket || !customConfig.region) {
        throw new Error('S3 configuration missing required properties: bucket and region')
      }
      const s3Config: S3Config = {
        bucket: customConfig.bucket,
        region: customConfig.region,
      }
      return downloadFromS3(key, s3Config)
    }
    return downloadFromS3(key)
  }

  const { readFile } = await import('fs/promises')
  const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/core/setup.server')

  const filePath = await validateLocalFilePath(key, UPLOAD_DIR_SERVER)

  try {
    return await readFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${key}`)
    }
    throw error
  }
}

/**
 * Delete a file from the configured storage provider
 * @param key File key/name
 */
export async function deleteFile(key: string): Promise<void> {
  if (USE_BLOB_STORAGE) {
    const { deleteFromBlob } = await import('@/lib/uploads/providers/blob/client')
    return deleteFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    const { deleteFromS3 } = await import('@/lib/uploads/providers/s3/client')
    return deleteFromS3(key)
  }

  const { unlink } = await import('fs/promises')
  const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/core/setup.server')

  const filePath = await validateLocalFilePath(key, UPLOAD_DIR_SERVER)

  try {
    await unlink(filePath)
  } catch (error) {
    // File deletion is idempotent - if file doesn't exist, that's fine
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const { deleteFileMetadata } = await import('../server/metadata')
  await deleteFileMetadata(key)
}

/**
 * Get the current storage provider name
 */
export function getStorageProvider(): 'blob' | 's3' | 'local' {
  if (USE_BLOB_STORAGE) return 'blob'
  if (USE_S3_STORAGE) return 's3'
  return 'local'
}

/**
 * Get the appropriate serve path prefix based on storage provider
 */
export function getServePathPrefix(): string {
  if (USE_BLOB_STORAGE) return '/api/files/serve/blob/'
  if (USE_S3_STORAGE) return '/api/files/serve/s3/'
  return '/api/files/serve/'
}

/**
 * Get file metadata from storage provider
 * @param key File key/name
 * @param customConfig Optional custom storage configuration
 * @returns File metadata object with userId, workspaceId, originalName, uploadedAt, etc.
 */
export async function getFileMetadata(
  key: string,
  customConfig?: StorageConfig
): Promise<Record<string, string>> {
  const { getFileMetadataByKey } = await import('../server/metadata')
  const metadataRecord = await getFileMetadataByKey(key)

  if (metadataRecord) {
    return {
      userId: metadataRecord.userId,
      workspaceId: metadataRecord.workspaceId || '',
      originalName: metadataRecord.originalName,
      uploadedAt: metadataRecord.uploadedAt.toISOString(),
      purpose: metadataRecord.context,
    }
  }

  if (USE_BLOB_STORAGE) {
    const { getBlobServiceClient } = await import('@/lib/uploads/providers/blob/client')
    const { BLOB_CONFIG } = await import('@/lib/uploads/config')

    let blobServiceClient = await getBlobServiceClient()
    let containerName = BLOB_CONFIG.containerName

    if (customConfig) {
      const { BlobServiceClient, StorageSharedKeyCredential } = await import('@azure/storage-blob')
      if (customConfig.connectionString) {
        blobServiceClient = BlobServiceClient.fromConnectionString(customConfig.connectionString)
      } else if (customConfig.accountName && customConfig.accountKey) {
        const credential = new StorageSharedKeyCredential(
          customConfig.accountName,
          customConfig.accountKey
        )
        blobServiceClient = new BlobServiceClient(
          `https://${customConfig.accountName}.blob.core.windows.net`,
          credential
        )
      }
      containerName = customConfig.containerName || containerName
    }

    const containerClient = blobServiceClient.getContainerClient(containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(key)
    const properties = await blockBlobClient.getProperties()
    return properties.metadata || {}
  }

  if (USE_S3_STORAGE) {
    const { getS3Client } = await import('@/lib/uploads/providers/s3/client')
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
    const { S3_CONFIG } = await import('@/lib/uploads/config')

    const s3Client = getS3Client()
    const bucket = customConfig?.bucket || S3_CONFIG.bucket

    if (!bucket) {
      throw new Error('S3 bucket not configured')
    }

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    })

    const response = await s3Client.send(command)
    return response.Metadata || {}
  }

  return {}
}
