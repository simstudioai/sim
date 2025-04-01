import { ensureUploadsDirectory, USE_S3_STORAGE, S3_CONFIG } from './setup'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UploadsSetup')

// Immediately invoke on server startup
if (typeof process !== 'undefined') {
  // Log storage mode
  logger.info(`Storage mode: ${USE_S3_STORAGE ? 'S3' : 'Local'}`)
  
  if (USE_S3_STORAGE) {
    logger.info('Using S3 storage mode with configuration:')
    logger.info(`- Bucket: ${S3_CONFIG.bucket}`)
    logger.info(`- Region: ${S3_CONFIG.region}`)
    
    // Verify AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      logger.warn('AWS credentials are not set in environment variables.')
      logger.warn('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for S3 storage.')
    } else {
      logger.info('AWS credentials found in environment variables')
    }
  } else {
    // Only initialize local uploads directory in development mode
    ensureUploadsDirectory().then((success) => {
      if (success) {
        logger.info('Local uploads directory initialized')
      } else {
        logger.error('Failed to initialize local uploads directory')
      }
    })
  }
}

export default ensureUploadsDirectory 