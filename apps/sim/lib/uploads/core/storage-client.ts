import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/config'
import type { StorageConfig } from '@/lib/uploads/shared/types'

import { createLogger } from '@/lib/logs/console/logger'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/core/setup'
import type { CustomBlobConfig } from '@/lib/uploads/providers/blob/blob-client'
import type { CustomS3Config } from '@/lib/uploads/providers/s3/s3-client'

const logger = createLogger('StorageClient')

// Client-safe type definitions
export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export type CustomStorageConfig = {
  // S3 config
  bucket?: string
  region?: string
  // Blob config
  containerName?: string
  accountName?: string
  accountKey?: string
  connectionString?: string
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
  customConfig: CustomStorageConfig,
  size?: number
): Promise<FileInfo>

export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  configOrSize?: CustomStorageConfig | number,
  size?: number
): Promise<FileInfo> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Uploading file to Azure Blob Storage: ${fileName}`)
    const { uploadToBlob } = await import('@/lib/uploads/providers/blob/blob-client')
    if (typeof configOrSize === 'object') {
      const blobConfig: CustomBlobConfig = {
        containerName: configOrSize.containerName!,
        accountName: configOrSize.accountName!,
        accountKey: configOrSize.accountKey,
        connectionString: configOrSize.connectionString,
      }
      return uploadToBlob(file, fileName, contentType, blobConfig, size)
    }
    return uploadToBlob(file, fileName, contentType, configOrSize)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Uploading file to S3: ${fileName}`)
    const { uploadToS3 } = await import('@/lib/uploads/providers/s3/s3-client')
    if (typeof configOrSize === 'object') {
      const s3Config: CustomS3Config = {
        bucket: configOrSize.bucket!,
        region: configOrSize.region!,
      }
      return uploadToS3(file, fileName, contentType, s3Config, size)
    }
    return uploadToS3(file, fileName, contentType, configOrSize)
  }

  if (typeof window !== 'undefined') {
    throw new Error('Local file upload is only supported on the server')
  }

  logger.info(`Uploading file to local storage: ${fileName}`)
  const { writeFile } = require('fs/promises')
  const { join } = require('path')
  const { v4: uuidv4 } = require('uuid')
  const { UPLOAD_DIR_SERVER } = require('@/lib/uploads/core/setup.server')

  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.\./g, '')
  const uniqueKey = `${uuidv4()}-${safeFileName}`
  const filePath = join(UPLOAD_DIR_SERVER, uniqueKey)

  try {
    await writeFile(filePath, file)
  } catch (error) {
    logger.error(`Failed to write file to local storage: ${fileName}`, error)
    throw new Error(
      `Failed to write file to local storage: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
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
export async function downloadFile(key: string, customConfig: CustomStorageConfig): Promise<Buffer>

export async function downloadFile(
  key: string,
  customConfig?: CustomStorageConfig
): Promise<Buffer> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Downloading file from Azure Blob Storage: ${key}`)
    const { downloadFromBlob } = await import('@/lib/uploads/providers/blob/blob-client')
    if (customConfig) {
      const blobConfig: CustomBlobConfig = {
        containerName: customConfig.containerName!,
        accountName: customConfig.accountName!,
        accountKey: customConfig.accountKey,
        connectionString: customConfig.connectionString,
      }
      return downloadFromBlob(key, blobConfig)
    }
    return downloadFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Downloading file from S3: ${key}`)
    const { downloadFromS3 } = await import('@/lib/uploads/providers/s3/s3-client')
    if (customConfig) {
      const s3Config: CustomS3Config = {
        bucket: customConfig.bucket!,
        region: customConfig.region!,
      }
      return downloadFromS3(key, s3Config)
    }
    return downloadFromS3(key)
  }

  if (typeof window !== 'undefined') {
    throw new Error('Local file download is only supported on the server')
  }

  logger.info(`Downloading file from local storage: ${key}`)
  const { readFile } = require('fs/promises')
  const { join, resolve, sep } = require('path')
  const { UPLOAD_DIR_SERVER } = require('@/lib/uploads/core/setup.server')

  const safeKey = key.replace(/\.\./g, '').replace(/[/\\]/g, '')
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  const resolvedPath = resolve(filePath)
  const allowedDir = resolve(UPLOAD_DIR_SERVER)
  if (!resolvedPath.startsWith(allowedDir + sep) && resolvedPath !== allowedDir) {
    throw new Error('Invalid file path')
  }

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
    logger.info(`Deleting file from Azure Blob Storage: ${key}`)
    const { deleteFromBlob } = await import('@/lib/uploads/providers/blob/blob-client')
    return deleteFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Deleting file from S3: ${key}`)
    const { deleteFromS3 } = await import('@/lib/uploads/providers/s3/s3-client')
    return deleteFromS3(key)
  }

  if (typeof window !== 'undefined') {
    throw new Error('Local file deletion is only supported on the server')
  }

  logger.info(`Deleting file from local storage: ${key}`)
  const { unlink } = require('fs/promises')
  const { join, resolve, sep } = require('path')
  const { UPLOAD_DIR_SERVER } = require('@/lib/uploads/core/setup.server')

  const safeKey = key.replace(/\.\./g, '').replace(/[/\\]/g, '')
  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  const resolvedPath = resolve(filePath)
  const allowedDir = resolve(UPLOAD_DIR_SERVER)
  if (!resolvedPath.startsWith(allowedDir + sep) && resolvedPath !== allowedDir) {
    throw new Error('Invalid file path')
  }

  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(`File not found during deletion: ${key}`)
      return
    }
    throw error
  }
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
 * Get the serve path prefix (unified across all storage providers)
 */
export function getServePathPrefix(): string {
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
