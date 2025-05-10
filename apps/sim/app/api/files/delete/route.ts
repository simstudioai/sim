import { NextRequest } from 'next/server'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { createLogger } from '@/lib/logs/console-logger'
import { deleteFromS3 } from '@/lib/uploads/s3-client'
import { UPLOAD_DIR, USE_S3_STORAGE } from '@/lib/uploads/setup'
// Import to ensure the uploads directory is created
import '@/lib/uploads/setup.server'
import {
  createErrorResponse,
  createOptionsResponse,
  createSuccessResponse,
  extractFilename,
  extractS3Key,
  InvalidRequestError,
  isS3Path,
} from '../utils'

const logger = createLogger('FilesDeleteAPI')

/**
 * Main API route handler for file deletion
 */
export async function POST(request: NextRequest) {
  try {
    const requestData = await request.json()
    const { filePath } = requestData

    logger.info('File delete request received:', { filePath })

    if (!filePath) {
      throw new InvalidRequestError('No file path provided')
    }

    try {
      // Use appropriate handler based on path and environment
      const result =
        isS3Path(filePath) || USE_S3_STORAGE
          ? await handleS3FileDelete(filePath)
          : await handleLocalFileDelete(filePath)

      // Return success response
      return createSuccessResponse(result)
    } catch (error) {
      logger.error('Error deleting file:', error)
      return createErrorResponse(
        error instanceof Error ? error : new Error('Failed to delete file')
      )
    }
  } catch (error) {
    logger.error('Error parsing request:', error)
    return createErrorResponse(error instanceof Error ? error : new Error('Invalid request'))
  }
}

/**
 * Handle S3 file deletion
 */
async function handleS3FileDelete(filePath: string) {
  // Extract the S3 key from the path
  const s3Key = extractS3Key(filePath)
  logger.info(`Deleting file from S3: ${s3Key}`)

  try {
    // Delete from S3
    await deleteFromS3(s3Key)
    logger.info(`File successfully deleted from S3: ${s3Key}`)

    return {
      success: true as const,
      message: 'File deleted successfully from S3',
    }
  } catch (error) {
    logger.error('Error deleting file from S3:', error)
    throw error
  }
}

/**
 * Handle local file deletion
 */
async function handleLocalFileDelete(filePath: string) {
  // Extract the filename from the path
  const filename = extractFilename(filePath)
  logger.info('Extracted filename for deletion:', filename)

  const fullPath = join(UPLOAD_DIR, filename)
  logger.info('Full file path for deletion:', fullPath)

  // Check if file exists
  if (!existsSync(fullPath)) {
    logger.info(`File not found for deletion at path: ${fullPath}`)
    return {
      success: true as const,
      message: "File not found, but that's okay",
    }
  }

  // Delete the file
  await unlink(fullPath)
  logger.info(`File successfully deleted: ${fullPath}`)

  return {
    success: true as const,
    message: 'File deleted successfully',
  }
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return createOptionsResponse()
}
