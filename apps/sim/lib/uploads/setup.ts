import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UploadsSetup')

const PROJECT_ROOT = path.resolve(process.cwd())

export const UPLOAD_DIR = join(PROJECT_ROOT, 'uploads')

// Check if S3 is configured (has required credentials)
const hasS3Config = !!(env.S3_BUCKET_NAME && env.AWS_REGION)

// Check if Azure Blob is configured (has required credentials)
const hasBlobConfig = !!(
  env.AZURE_STORAGE_CONTAINER_NAME &&
  ((env.AZURE_ACCOUNT_NAME && env.AZURE_ACCOUNT_KEY) || env.AZURE_CONNECTION_STRING)
)

// Storage configuration flags - auto-detect based on available credentials
// Priority: Blob > S3 > Local (if both are configured, Blob takes priority)
export const USE_BLOB_STORAGE = hasBlobConfig
export const USE_S3_STORAGE = hasS3Config && !USE_BLOB_STORAGE

export const S3_CONFIG = {
  bucket: env.S3_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_CONTAINER_NAME || '',
}

export const S3_KB_CONFIG = {
  bucket: env.S3_KB_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_KB_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_KB_CONTAINER_NAME || '',
}

export async function ensureUploadsDirectory() {
  if (USE_S3_STORAGE) {
    logger.info('Using S3 storage, skipping local uploads directory creation')
    return true
  }

  if (USE_BLOB_STORAGE) {
    logger.info('Using Azure Blob storage, skipping local uploads directory creation')
    return true
  }

  try {
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    } else {
      logger.info(`Uploads directory already exists at ${UPLOAD_DIR}`)
    }
    return true
  } catch (error) {
    logger.error('Failed to create uploads directory:', error)
    return false
  }
}

/**
 * Get the current storage provider as a human-readable string
 */
export function getStorageProvider(): 'Azure Blob' | 'S3' | 'Local' {
  if (USE_BLOB_STORAGE) return 'Azure Blob'
  if (USE_S3_STORAGE) return 'S3'
  return 'Local'
}

/**
 * Check if we're using any cloud storage (S3 or Blob)
 */
export function isUsingCloudStorage(): boolean {
  return USE_S3_STORAGE || USE_BLOB_STORAGE
}
