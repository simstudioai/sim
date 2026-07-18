import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import {
  getStorageProvider,
  S3_CONFIG,
  USE_BLOB_STORAGE,
  USE_GCS_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'

const logger = createLogger('UploadsSetup')

// turbopackIgnore: an unscoped process.cwd() makes node-file-tracing sweep the whole
// project (including next.config.ts) into every route graph that reaches this module.
// Two routes doing so emit the swept config into same-named server chunks — when their
// contents diverge, the build dies with "Two or more assets … same output path".
const PROJECT_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd())
export const UPLOAD_DIR_SERVER = join(/*turbopackIgnore: true*/ PROJECT_ROOT, 'uploads')

/**
 * Server-only function to ensure uploads directory exists
 */
async function ensureUploadsDirectory() {
  if (USE_S3_STORAGE) {
    logger.info('Using S3 storage, skipping local uploads directory creation')
    return true
  }

  if (USE_BLOB_STORAGE) {
    logger.info('Using Azure Blob storage, skipping local uploads directory creation')
    return true
  }

  if (USE_GCS_STORAGE) {
    logger.info('Using Google Cloud Storage, skipping local uploads directory creation')
    return true
  }

  try {
    if (!existsSync(UPLOAD_DIR_SERVER)) {
      await mkdir(UPLOAD_DIR_SERVER, { recursive: true })
    } else {
      logger.info(`Uploads directory already exists at ${UPLOAD_DIR_SERVER}`)
    }
    return true
  } catch (error) {
    logger.error('Failed to create uploads directory:', error)
    return false
  }
}

// Immediately invoke on server startup
if (typeof process !== 'undefined') {
  const storageProvider = getStorageProvider()

  // Log storage mode
  logger.info(`Storage provider: ${storageProvider}`)

  if (USE_BLOB_STORAGE) {
    // Verify Azure Blob credentials
    if (!env.AZURE_STORAGE_CONTAINER_NAME) {
      logger.warn('Azure Blob storage is enabled but AZURE_STORAGE_CONTAINER_NAME is not set')
    } else if (!env.AZURE_ACCOUNT_NAME && !env.AZURE_CONNECTION_STRING) {
      logger.warn(
        'Azure Blob storage is enabled but neither AZURE_ACCOUNT_NAME nor AZURE_CONNECTION_STRING is set'
      )
      logger.warn(
        'Set AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY or AZURE_CONNECTION_STRING for Azure Blob storage'
      )
    } else if (env.AZURE_ACCOUNT_NAME && !env.AZURE_ACCOUNT_KEY && !env.AZURE_CONNECTION_STRING) {
      logger.warn(
        'AZURE_ACCOUNT_NAME is set but AZURE_ACCOUNT_KEY is missing and no AZURE_CONNECTION_STRING provided'
      )
      logger.warn('Set AZURE_ACCOUNT_KEY or use AZURE_CONNECTION_STRING for authentication')
    } else {
      logger.info('Azure Blob storage credentials found in environment variables')
      if (env.AZURE_CONNECTION_STRING) {
        logger.info('Using Azure connection string for authentication')
      } else {
        logger.info('Using Azure account name and key for authentication')
      }
    }
  } else if (USE_S3_STORAGE) {
    // Verify AWS credentials
    if (!env.S3_BUCKET_NAME || !env.AWS_REGION) {
      logger.warn('S3 storage configuration is incomplete')
      logger.warn('Set S3_BUCKET_NAME and AWS_REGION for S3 storage')
    } else if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      logger.warn('AWS credentials are not set in environment variables')
      logger.warn('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for S3 storage')
    } else {
      logger.info('AWS S3 credentials found in environment variables')
    }

    if (env.S3_ENDPOINT) {
      logger.info(
        `Using S3-compatible endpoint: ${env.S3_ENDPOINT} (path-style: ${S3_CONFIG.forcePathStyle})`
      )
    }
  } else if (USE_GCS_STORAGE) {
    // Verify GCS credentials
    if (env.GCS_CREDENTIALS_JSON) {
      logger.info('Using inline service-account credentials (GCS_CREDENTIALS_JSON)')
    } else {
      logger.info(
        'GCS_CREDENTIALS_JSON not set — using Application Default Credentials (Workload Identity or GOOGLE_APPLICATION_CREDENTIALS)'
      )
      logger.info(
        'Signed URL generation without a private key requires the iam.serviceAccounts.signBlob permission (roles/iam.serviceAccountTokenCreator)'
      )
    }
  } else {
    // Local storage mode
    logger.info('Using local file storage')

    // Only initialize local uploads directory when using local storage
    ensureUploadsDirectory().then((success) => {
      if (success) {
        logger.info('Local uploads directory initialized')
      } else {
        logger.error('Failed to initialize local uploads directory')
      }
    })
  }

  // Log additional configuration details
  if (USE_BLOB_STORAGE && env.AZURE_STORAGE_KB_CONTAINER_NAME) {
    logger.info(`Azure Blob knowledge base container: ${env.AZURE_STORAGE_KB_CONTAINER_NAME}`)
  }
  if (USE_BLOB_STORAGE && env.AZURE_STORAGE_COPILOT_CONTAINER_NAME) {
    logger.info(`Azure Blob copilot container: ${env.AZURE_STORAGE_COPILOT_CONTAINER_NAME}`)
  }
  if (USE_S3_STORAGE && env.S3_KB_BUCKET_NAME) {
    logger.info(`S3 knowledge base bucket: ${env.S3_KB_BUCKET_NAME}`)
  }
  if (USE_S3_STORAGE && env.S3_COPILOT_BUCKET_NAME) {
    logger.info(`S3 copilot bucket: ${env.S3_COPILOT_BUCKET_NAME}`)
  }
  if (USE_GCS_STORAGE && env.GCS_KB_BUCKET_NAME) {
    logger.info(`GCS knowledge base bucket: ${env.GCS_KB_BUCKET_NAME}`)
  }
  if (USE_GCS_STORAGE && env.GCS_COPILOT_BUCKET_NAME) {
    logger.info(`GCS copilot bucket: ${env.GCS_COPILOT_BUCKET_NAME}`)
  }
}
