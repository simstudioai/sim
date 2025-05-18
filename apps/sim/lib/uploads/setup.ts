import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import path from 'path'
import { createLogger } from '@/lib/logs/console-logger'
import { env } from '../env'

const logger = createLogger('UploadsSetup')

// Define project root - this works regardless of how the app is started
const PROJECT_ROOT = path.resolve(process.cwd())

// Define the upload directory path using project root
export const UPLOAD_DIR = join(PROJECT_ROOT, 'uploads')

export const USE_S3_STORAGE = env.NODE_ENV === 'production' || env.USE_S3

export const S3_CONFIG = {
  bucket: env.S3_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

/**
 * Ensures that the uploads directory exists (for local storage)
 */
export async function ensureUploadsDirectory() {
  if (USE_S3_STORAGE) {
    logger.info('Using S3 storage, skipping local uploads directory creation')
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
