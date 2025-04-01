import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import path from 'path'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UploadsSetup')

// Define project root - this works regardless of how the app is started
const PROJECT_ROOT = path.resolve(process.cwd())

// Define the upload directory path using project root
export const UPLOAD_DIR = join(PROJECT_ROOT, 'uploads')

export const USE_S3_STORAGE = process.env.NODE_ENV === 'production' || process.env.USE_S3 === 'true'

export const S3_CONFIG = {
  bucket: process.env.S3_BUCKET_NAME || 'sim-studio-files',
  region: process.env.AWS_REGION || 'us-east-1',
  baseUrl: process.env.S3_BASE_URL || `https://${process.env.S3_BUCKET_NAME || 'sim-studio-files'}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`
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
      logger.info(`Creating uploads directory at ${UPLOAD_DIR}`)
      await mkdir(UPLOAD_DIR, { recursive: true })
      logger.info(`Created uploads directory at ${UPLOAD_DIR}`)
    } else {
      logger.info(`Uploads directory already exists at ${UPLOAD_DIR}`)
    }
    return true
  } catch (error) {
    logger.error('Failed to create uploads directory:', error)
    return false
  }
} 