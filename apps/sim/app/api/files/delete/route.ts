import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads/config'
import { deleteFile, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { extractStorageKey, inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess } from '@/app/api/files/authorization'
import {
  createErrorResponse,
  createOptionsResponse,
  createSuccessResponse,
  extractFilename,
  FileNotFoundError,
  InvalidRequestError,
} from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesDeleteAPI')

/**
 * Main API route handler for file deletion
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn('Unauthorized file delete request', {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const requestData = await request.json()
    const { filePath, context } = requestData

    logger.info('File delete request received:', { filePath, context, userId })

    if (!filePath) {
      throw new InvalidRequestError('No file path provided')
    }

    try {
      const key = extractStorageKeyFromPath(filePath)

      const storageContext: StorageContext = context || inferContextFromKey(key)

      const hasAccess = await verifyFileAccess(
        key,
        userId,
        undefined, // customConfig
        storageContext, // context
        !hasCloudStorage() // isLocal
      )

      if (!hasAccess) {
        logger.warn('Unauthorized file delete attempt', { userId, key, context: storageContext })
        throw new FileNotFoundError(`File not found: ${key}`)
      }

      logger.info(`Deleting file with key: ${key}, context: ${storageContext}`)

      await deleteFile({
        key,
        context: storageContext,
      })

      logger.info(`File successfully deleted: ${key}`)

      return createSuccessResponse({
        success: true,
        message: 'File deleted successfully',
      })
    } catch (error) {
      logger.error('Error deleting file:', error)

      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }

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
 * Extract storage key from file path
 */
function extractStorageKeyFromPath(filePath: string): string {
  if (filePath.startsWith('/api/files/serve/')) {
    return extractStorageKey(filePath)
  }

  return extractFilename(filePath)
}

/**
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return createOptionsResponse()
}
