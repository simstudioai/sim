import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { deleteFile, isUsingCloudStorage } from '@/lib/uploads'
import { UPLOAD_DIR } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'

import {
  createErrorResponse,
  createOptionsResponse,
  createSuccessResponse,
  extractBlobKey,
  extractFilename,
  extractS3Key,
  InvalidRequestError,
  isBlobPath,
  isCloudPath,
  isS3Path,
} from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

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
        isCloudPath(filePath) || isUsingCloudStorage()
          ? await handleCloudFileDelete(filePath)
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
 * Handle cloud file deletion (S3 or Azure Blob)
 */
async function handleCloudFileDelete(filePath: string) {
  // Extract the key from the path (works for both S3 and Blob paths)
  const key = extractCloudKey(filePath)
  logger.info(`Deleting file from cloud storage: ${key}`)

  try {
    // Delete from cloud storage using abstraction layer
    await deleteFile(key)
    logger.info(`File successfully deleted from cloud storage: ${key}`)

    return {
      success: true as const,
      message: 'File deleted successfully from cloud storage',
    }
  } catch (error) {
    logger.error('Error deleting file from cloud storage:', error)
    throw error
  }
}

/**
 * Handle local file deletion
 */
async function handleLocalFileDelete(filePath: string) {
  const filename = extractFilename(filePath)
  const fullPath = join(UPLOAD_DIR, filename)

  logger.info(`Deleting local file: ${fullPath}`)

  if (!existsSync(fullPath)) {
    logger.info(`File not found, but that's okay: ${fullPath}`)
    return {
      success: true as const,
      message: "File not found, but that's okay",
    }
  }

  try {
    await unlink(fullPath)
    logger.info(`File successfully deleted: ${fullPath}`)

    return {
      success: true as const,
      message: 'File deleted successfully',
    }
  } catch (error) {
    logger.error('Error deleting local file:', error)
    throw error
  }
}

/**
 * Extract cloud storage key from file path (works for both S3 and Blob)
 */
function extractCloudKey(filePath: string): string {
  if (isS3Path(filePath)) {
    return extractS3Key(filePath)
  }

  if (isBlobPath(filePath)) {
    return extractBlobKey(filePath)
  }

  // Backwards-compatibility: allow generic paths like "/api/files/serve/<key>"
  if (filePath.startsWith('/api/files/serve/')) {
    return decodeURIComponent(filePath.substring('/api/files/serve/'.length))
  }

  // As a last resort assume the incoming string is already a raw key.
  return filePath
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return createOptionsResponse()
}
