import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { cwd } from 'process'

// Define the upload directory path
export const UPLOAD_DIR = join(cwd(), 'uploads')

/**
 * Ensures that the uploads directory exists
 */
export async function ensureUploadsDirectory() {
  try {
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
      console.log(`Created uploads directory at ${UPLOAD_DIR}`)
    }
    return true
  } catch (error) {
    console.error('Failed to create uploads directory:', error)
    return false
  }
} 