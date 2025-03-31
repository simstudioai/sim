import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import path from 'path'
import { cwd } from 'process'

// Define project root - this works regardless of how the app is started
const PROJECT_ROOT = path.resolve(process.cwd())

// Define the upload directory path using project root
export const UPLOAD_DIR = join(PROJECT_ROOT, 'sim', 'uploads')

/**
 * Ensures that the uploads directory exists
 */
export async function ensureUploadsDirectory() {
  try {
    if (!existsSync(UPLOAD_DIR)) {
      console.log(`Creating uploads directory at ${UPLOAD_DIR}`)
      await mkdir(UPLOAD_DIR, { recursive: true })
      console.log(`Created uploads directory at ${UPLOAD_DIR}`)
    } else {
      console.log(`Uploads directory already exists at ${UPLOAD_DIR}`)
    }
    return true
  } catch (error) {
    console.error('Failed to create uploads directory:', error)
    return false
  }
} 