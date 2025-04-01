import { ensureUploadsDirectory, USE_S3_STORAGE, S3_CONFIG } from './setup'

// Immediately invoke on server startup
if (typeof process !== 'undefined') {
  // Log storage mode
  console.log(`Storage mode: ${USE_S3_STORAGE ? 'S3' : 'Local'}`)
  
  if (USE_S3_STORAGE) {
    console.log('Using S3 storage mode with configuration:')
    console.log(`- Bucket: ${S3_CONFIG.bucket}`)
    console.log(`- Region: ${S3_CONFIG.region}`)
    
    // Verify AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.warn('⚠️ AWS credentials are not set in environment variables.')
      console.warn('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY for S3 storage.')
    } else {
      console.log('✅ AWS credentials found in environment variables')
    }
  } else {
    // Only initialize local uploads directory in development mode
    ensureUploadsDirectory().then((success) => {
      if (success) {
        console.log('✅ Local uploads directory initialized')
      } else {
        console.error('❌ Failed to initialize local uploads directory')
      }
    })
  }
}

export default ensureUploadsDirectory 