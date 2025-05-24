import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'
import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { env } from '../env'

const logger = createLogger('UploadsSetup')

const PROJECT_ROOT = path.resolve(process.cwd())

export const UPLOAD_DIR = join(PROJECT_ROOT, 'uploads')

export const USE_S3_STORAGE = isProd

export const S3_CONFIG = {
  bucket: env.S3_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

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
