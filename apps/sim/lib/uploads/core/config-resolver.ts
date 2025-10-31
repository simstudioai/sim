import {
  BLOB_CHAT_CONFIG,
  BLOB_CONFIG,
  BLOB_COPILOT_CONFIG,
  BLOB_EXECUTION_FILES_CONFIG,
  BLOB_KB_CONFIG,
  BLOB_PROFILE_PICTURES_CONFIG,
  S3_CHAT_CONFIG,
  S3_CONFIG,
  S3_COPILOT_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  S3_KB_CONFIG,
  S3_PROFILE_PICTURES_CONFIG,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/core/setup'

export type StorageContext =
  | 'general'
  | 'knowledge-base'
  | 'chat'
  | 'copilot'
  | 'execution'
  | 'workspace'
  | 'profile-pictures'

export interface StorageConfig {
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
 * Get the appropriate storage configuration for a given context
 * Automatically selects between S3 and Blob based on USE_BLOB_STORAGE/USE_S3_STORAGE flags
 */
export function getStorageConfig(context: StorageContext): StorageConfig {
  if (USE_BLOB_STORAGE) {
    return getBlobConfig(context)
  }

  if (USE_S3_STORAGE) {
    return getS3Config(context)
  }

  // Local storage doesn't need config
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
      // Workspace files use general bucket but with custom key structure
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
      // Workspace files use general container but with custom key structure
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

  // Local storage is always available
  return true
}
