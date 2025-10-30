import { env } from '@/lib/env'
import type { StorageConfig, StorageContext } from '@/lib/uploads/shared/types'

export type { StorageConfig, StorageContext } from '@/lib/uploads/shared/types'
export const UPLOAD_DIR = '/uploads'

const hasS3Config = !!(env.S3_BUCKET_NAME && env.AWS_REGION)
const hasBlobConfig = !!(
  env.AZURE_STORAGE_CONTAINER_NAME &&
  ((env.AZURE_ACCOUNT_NAME && env.AZURE_ACCOUNT_KEY) || env.AZURE_CONNECTION_STRING)
)

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

export const S3_EXECUTION_FILES_CONFIG = {
  bucket: env.S3_EXECUTION_FILES_BUCKET_NAME || 'sim-execution-files',
  region: env.AWS_REGION || '',
}

export const BLOB_KB_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_KB_CONTAINER_NAME || '',
}

export const BLOB_EXECUTION_FILES_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME || 'sim-execution-files',
}

export const S3_CHAT_CONFIG = {
  bucket: env.S3_CHAT_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_CHAT_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_CHAT_CONTAINER_NAME || '',
}

export const S3_COPILOT_CONFIG = {
  bucket: env.S3_COPILOT_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_COPILOT_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_COPILOT_CONTAINER_NAME || '',
}

export const S3_PROFILE_PICTURES_CONFIG = {
  bucket: env.S3_PROFILE_PICTURES_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

export const BLOB_PROFILE_PICTURES_CONFIG = {
  accountName: env.AZURE_ACCOUNT_NAME || '',
  accountKey: env.AZURE_ACCOUNT_KEY || '',
  connectionString: env.AZURE_CONNECTION_STRING || '',
  containerName: env.AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME || '',
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

/**
 * Get the appropriate storage configuration for a given context
 */
export function getStorageConfig(context: StorageContext): StorageConfig {
  if (USE_BLOB_STORAGE) {
    return getBlobConfig(context)
  }

  if (USE_S3_STORAGE) {
    return getS3Config(context)
  }

  return {}
}

/**
 * Get S3 configuration for a given context
 */
function getS3Config(context: StorageContext): StorageConfig {
  switch (context) {
    case 'knowledge-base':
      return {
        bucket: S3_KB_CONFIG.bucket,
        region: S3_KB_CONFIG.region,
      }
    case 'chat':
      return {
        bucket: S3_CHAT_CONFIG.bucket,
        region: S3_CHAT_CONFIG.region,
      }
    case 'copilot':
      return {
        bucket: S3_COPILOT_CONFIG.bucket,
        region: S3_COPILOT_CONFIG.region,
      }
    case 'execution':
      return {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      }
    case 'workspace':
      return {
        bucket: S3_CONFIG.bucket,
        region: S3_CONFIG.region,
      }
    case 'profile-pictures':
      return {
        bucket: S3_PROFILE_PICTURES_CONFIG.bucket,
        region: S3_PROFILE_PICTURES_CONFIG.region,
      }
    default:
      return {
        bucket: S3_CONFIG.bucket,
        region: S3_CONFIG.region,
      }
  }
}

/**
 * Get Azure Blob configuration for a given context
 */
function getBlobConfig(context: StorageContext): StorageConfig {
  switch (context) {
    case 'knowledge-base':
      return {
        accountName: BLOB_KB_CONFIG.accountName,
        accountKey: BLOB_KB_CONFIG.accountKey,
        connectionString: BLOB_KB_CONFIG.connectionString,
        containerName: BLOB_KB_CONFIG.containerName,
      }
    case 'chat':
      return {
        accountName: BLOB_CHAT_CONFIG.accountName,
        accountKey: BLOB_CHAT_CONFIG.accountKey,
        connectionString: BLOB_CHAT_CONFIG.connectionString,
        containerName: BLOB_CHAT_CONFIG.containerName,
      }
    case 'copilot':
      return {
        accountName: BLOB_COPILOT_CONFIG.accountName,
        accountKey: BLOB_COPILOT_CONFIG.accountKey,
        connectionString: BLOB_COPILOT_CONFIG.connectionString,
        containerName: BLOB_COPILOT_CONFIG.containerName,
      }
    case 'execution':
      return {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      }
    case 'workspace':
      return {
        accountName: BLOB_CONFIG.accountName,
        accountKey: BLOB_CONFIG.accountKey,
        connectionString: BLOB_CONFIG.connectionString,
        containerName: BLOB_CONFIG.containerName,
      }
    case 'profile-pictures':
      return {
        accountName: BLOB_PROFILE_PICTURES_CONFIG.accountName,
        accountKey: BLOB_PROFILE_PICTURES_CONFIG.accountKey,
        connectionString: BLOB_PROFILE_PICTURES_CONFIG.connectionString,
        containerName: BLOB_PROFILE_PICTURES_CONFIG.containerName,
      }
    default:
      return {
        accountName: BLOB_CONFIG.accountName,
        accountKey: BLOB_CONFIG.accountKey,
        connectionString: BLOB_CONFIG.connectionString,
        containerName: BLOB_CONFIG.containerName,
      }
  }
}

/**
 * Check if a specific storage context is configured
 * Returns false if the context would fall back to general config but general isn't configured
 */
export function isStorageContextConfigured(context: StorageContext): boolean {
  const config = getStorageConfig(context)

  if (USE_BLOB_STORAGE) {
    return !!(
      config.containerName &&
      (config.connectionString || (config.accountName && config.accountKey))
    )
  }

  if (USE_S3_STORAGE) {
    return !!(config.bucket && config.region)
  }

  return true
}
