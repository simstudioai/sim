import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'
import { createLogger } from '@/lib/logs/console-logger'
import { USE_BLOB_STORAGE, USE_S3_STORAGE } from '@/lib/uploads/config'

const logger = createLogger('UploadsSetup')

const PROJECT_ROOT = path.resolve(process.cwd())

export const UPLOAD_DIR = join(PROJECT_ROOT, 'uploads')

// Re-export config for backward compatibility
export {
  BLOB_CONFIG,
  BLOB_KB_CONFIG,
  getStorageProvider,
  isUsingCloudStorage,
  S3_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  S3_KB_CONFIG,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'

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
