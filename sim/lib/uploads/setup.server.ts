import { ensureUploadsDirectory } from './setup'

// Immediately invoke on server startup
if (typeof process !== 'undefined') {
  ensureUploadsDirectory().then((success) => {
    if (success) {
      console.log('✅ Uploads directory initialized')
    } else {
      console.error('❌ Failed to initialize uploads directory')
    }
  })
}

export default ensureUploadsDirectory 