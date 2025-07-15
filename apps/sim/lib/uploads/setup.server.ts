import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'
import {
  ensureUploadsDirectory,
  getStorageProvider,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/setup'

const logger = createLogger('UploadsSetup')

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
  if (USE_S3_STORAGE && env.S3_KB_BUCKET_NAME) {
    logger.info(`S3 knowledge base bucket: ${env.S3_KB_BUCKET_NAME}`)
  }
}

export default ensureUploadsDirectory
