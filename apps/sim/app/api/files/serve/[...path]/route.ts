import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { CopilotFiles, isUsingCloudStorage } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
} from '@/app/api/files/utils'

const logger = createLogger('FilesServeAPI')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

    if (!path || path.length === 0) {
      throw new FileNotFoundError('No file path provided')
    }

    logger.info('File serve request:', { path })

    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn('Unauthorized file access attempt', { path, error: authResult.error })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const fullPath = path.join('/')
    const isS3Path = path[0] === 's3'
    const isBlobPath = path[0] === 'blob'
    const isCloudPath = isS3Path || isBlobPath
    const cloudKey = isCloudPath ? path.slice(1).join('/') : fullPath

    const contextParam = request.nextUrl.searchParams.get('context')
    const legacyBucketType = request.nextUrl.searchParams.get('bucket')

    if (isUsingCloudStorage() || isCloudPath) {
      return await handleCloudProxy(cloudKey, contextParam, legacyBucketType, userId)
    }

    return await handleLocalFile(fullPath, userId)
  } catch (error) {
    logger.error('Error serving file:', error)

    if (error instanceof FileNotFoundError) {
      return createErrorResponse(error)
    }

    return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
  }
}

async function handleLocalFile(filename: string, userId?: string): Promise<NextResponse> {
  try {
    const filePath = findLocalFile(filename)

    if (!filePath) {
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const fileBuffer = await readFile(filePath)
    const contentType = getContentType(filename)

    logger.info('Local file served', { userId, filename, size: fileBuffer.length })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename,
    })
  } catch (error) {
    logger.error('Error reading local file:', error)
    throw error
  }
}

/**
 * Infer storage context from file key pattern
 */
function inferContextFromKey(key: string): StorageContext {
  // KB files always start with 'kb/' prefix
  if (key.startsWith('kb/')) {
    return 'knowledge-base'
  }

  // Workspace files: UUID-like ID followed by timestamp pattern
  // Pattern: {uuid}/{timestamp}-{random}-{filename}
  if (key.match(/^[a-f0-9-]{36}\/\d+-[a-z0-9]+-/)) {
    return 'workspace'
  }

  // Execution files: three UUID segments (workspace/workflow/execution)
  // Pattern: {uuid}/{uuid}/{uuid}/{filename}
  const segments = key.split('/')
  if (segments.length >= 4 && segments[0].match(/^[a-f0-9-]{36}$/)) {
    return 'execution'
  }

  // Copilot files: timestamp-random-filename (no path segments)
  // Pattern: {timestamp}-{random}-{filename}
  // NOTE: This is ambiguous with other contexts - prefer explicit context parameter
  if (key.match(/^\d+-[a-z0-9]+-/)) {
    // Could be copilot, general, or chat - default to general
    return 'general'
  }

  return 'general'
}

async function handleCloudProxy(
  cloudKey: string,
  contextParam?: string | null,
  legacyBucketType?: string | null,
  userId?: string
): Promise<NextResponse> {
  try {
    let context: StorageContext

    if (contextParam) {
      context = contextParam as StorageContext
      logger.info(`Using explicit context: ${context} for key: ${cloudKey}`)
    } else if (legacyBucketType === 'copilot') {
      context = 'copilot'
      logger.info(`Using legacy bucket parameter for copilot context: ${cloudKey}`)
    } else {
      context = inferContextFromKey(cloudKey)
      logger.info(`Inferred context: ${context} from key pattern: ${cloudKey}`)
    }

    let fileBuffer: Buffer

    if (context === 'copilot') {
      fileBuffer = await CopilotFiles.downloadCopilotFile(cloudKey)
    } else {
      fileBuffer = await downloadFile({
        key: cloudKey,
        context,
      })
    }

    const originalFilename = cloudKey.split('/').pop() || 'download'
    const contentType = getContentType(originalFilename)

    logger.info('Cloud file served', {
      userId,
      key: cloudKey,
      size: fileBuffer.length,
      context,
    })

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename: originalFilename,
    })
  } catch (error) {
    logger.error('Error downloading from cloud storage:', error)
    throw error
  }
}
