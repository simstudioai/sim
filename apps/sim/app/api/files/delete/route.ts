import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { fileDeleteContract } from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { StorageContext } from '@/lib/uploads/config'
import { deleteFile, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { extractStorageKey, inferContextFromKey } from '@/lib/uploads/utils/file-utils'
import { verifyFileAccess, verifyKBFileWriteAccess } from '@/app/api/files/authorization'
import {
  createErrorResponse,
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
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn('Unauthorized file delete request', {
        error: authResult.error || 'Missing userId',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    const parsed = await parseRequest(
      fileDeleteContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          createErrorResponse(
            new InvalidRequestError(getValidationErrorMessage(error, 'Invalid request data'))
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const { filePath, context } = parsed.data.body

    logger.info('File delete request received:', { filePath, context, userId })

    if (!filePath) {
      throw new InvalidRequestError('No file path provided')
    }

    try {
      const key = extractStorageKeyFromPath(filePath)

      // Derive context from the trusted key prefix, never the client-supplied value; a supplied context must agree with the key.
      const storageContext: StorageContext = inferContextFromKey(key)
      if (context && context !== storageContext) {
        logger.warn('File delete context mismatch', { key, context, inferred: storageContext })
        throw new InvalidRequestError(`Provided context "${context}" does not match the file key`)
      }

      // Deletes require write/admin on the owning workspace; KB deletes are binding-only with no read fallback.
      const hasAccess =
        storageContext === 'knowledge-base'
          ? await verifyKBFileWriteAccess(key, userId)
          : await verifyFileAccess(key, userId, undefined, storageContext, !hasCloudStorage(), {
              requireWrite: true,
            })

      if (!hasAccess) {
        logger.warn('Unauthorized file delete attempt', { userId, key, context: storageContext })
        throw new FileNotFoundError(`File not found: ${key}`)
      }

      logger.info(`Deleting file with key: ${key}, context: ${storageContext}`)

      await deleteFile({
        key,
        context: storageContext,
      })
      await deleteFileMetadata(key)

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
})

/**
 * Extract storage key from file path
 */
function extractStorageKeyFromPath(filePath: string): string {
  if (filePath.startsWith('/api/files/serve/')) {
    return extractStorageKey(filePath)
  }

  return extractFilename(filePath)
}
