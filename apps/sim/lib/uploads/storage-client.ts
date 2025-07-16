import { createLogger } from '@/lib/logs/console-logger'
import {
  type FileInfo as BlobFileInfo,
  type CustomBlobConfig,
  deleteFromBlob,
  downloadFromBlob,
  getPresignedUrl as getBlobPresignedUrl,
  getPresignedUrlWithConfig as getBlobPresignedUrlWithConfig,
  uploadToBlob,
} from '@/lib/uploads/blob/blob-client'
import {
  type CustomS3Config,
  deleteFromS3,
  downloadFromS3,
  getPresignedUrl as getS3PresignedUrl,
  getPresignedUrlWithConfig as getS3PresignedUrlWithConfig,
  type FileInfo as S3FileInfo,
  uploadToS3,
} from '@/lib/uploads/s3/s3-client'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/setup'

const logger = createLogger('StorageClient')

export type FileInfo = S3FileInfo | BlobFileInfo
export type CustomStorageConfig = CustomS3Config | CustomBlobConfig

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
    if (typeof configOrSize === 'object') {
      return uploadToBlob(file, fileName, contentType, configOrSize as CustomBlobConfig, size)
    }
    return uploadToBlob(file, fileName, contentType, configOrSize)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Uploading file to S3: ${fileName}`)
    if (typeof configOrSize === 'object') {
      return uploadToS3(file, fileName, contentType, configOrSize as CustomS3Config, size)
    }
    return uploadToS3(file, fileName, contentType, configOrSize)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Download a file from the configured storage provider
 * @param key File key/name
 * @returns File buffer
 */
export async function downloadFile(key: string): Promise<Buffer> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Downloading file from Azure Blob Storage: ${key}`)
    return downloadFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Downloading file from S3: ${key}`)
    return downloadFromS3(key)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Delete a file from the configured storage provider
 * @param key File key/name
 */
export async function deleteFile(key: string): Promise<void> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Deleting file from Azure Blob Storage: ${key}`)
    return deleteFromBlob(key)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Deleting file from S3: ${key}`)
    return deleteFromS3(key)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Generate a presigned URL for direct file access
 * @param key File key/name
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Generating presigned URL for Azure Blob Storage: ${key}`)
    return getBlobPresignedUrl(key, expiresIn)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Generating presigned URL for S3: ${key}`)
    return getS3PresignedUrl(key, expiresIn)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
}

/**
 * Generate a presigned URL for direct file access with custom configuration
 * @param key File key/name
 * @param customConfig Custom storage configuration
 * @param expiresIn Time in seconds until URL expires
 * @returns Presigned URL
 */
export async function getPresignedUrlWithConfig(
  key: string,
  customConfig: CustomStorageConfig,
  expiresIn = 3600
): Promise<string> {
  if (USE_BLOB_STORAGE) {
    logger.info(`Generating presigned URL for Azure Blob Storage with custom config: ${key}`)
    return getBlobPresignedUrlWithConfig(key, customConfig as CustomBlobConfig, expiresIn)
  }

  if (USE_S3_STORAGE) {
    logger.info(`Generating presigned URL for S3 with custom config: ${key}`)
    return getS3PresignedUrlWithConfig(key, customConfig as CustomS3Config, expiresIn)
  }

  throw new Error(
    'No storage provider configured. Set Azure credentials (AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY) or configure AWS credentials for S3.'
  )
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
 * Check if we're using cloud storage (either S3 or Blob)
 */
export function isUsingCloudStorage(): boolean {
  return USE_BLOB_STORAGE || USE_S3_STORAGE
}

/**
 * Get the appropriate serve path prefix based on storage provider
 */
export function getServePathPrefix(): string {
  if (USE_BLOB_STORAGE) return '/api/files/serve/blob/'
  if (USE_S3_STORAGE) return '/api/files/serve/s3/'
  return '/api/files/serve/'
}
