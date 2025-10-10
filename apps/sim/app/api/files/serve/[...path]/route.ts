import { readFile } from 'fs/promises'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { downloadFile, getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import { S3_KB_CONFIG } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'
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

    if (isUsingCloudStorage() || isCloudPath) {
      const bucketType = request.nextUrl.searchParams.get('bucket')
      return await handleCloudProxy(cloudKey, bucketType, userId)
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

async function downloadKBFile(cloudKey: string): Promise<Buffer> {
  logger.info(`Downloading KB file: ${cloudKey}`)
  const storageProvider = getStorageProvider()

  if (storageProvider === 'blob') {
    const { BLOB_KB_CONFIG } = await import('@/lib/uploads/setup')
    return downloadFile(cloudKey, {
      containerName: BLOB_KB_CONFIG.containerName,
      accountName: BLOB_KB_CONFIG.accountName,
      accountKey: BLOB_KB_CONFIG.accountKey,
      connectionString: BLOB_KB_CONFIG.connectionString,
    })
  }

  if (storageProvider === 's3') {
    return downloadFile(cloudKey, {
      bucket: S3_KB_CONFIG.bucket,
      region: S3_KB_CONFIG.region,
    })
  }

  throw new Error(`Unsupported storage provider for KB files: ${storageProvider}`)
}

async function handleCloudProxy(
  cloudKey: string,
  bucketType?: string | null,
  userId?: string
): Promise<NextResponse> {
  try {
    // Check if this is a KB file (starts with 'kb/')
    const isKBFile = cloudKey.startsWith('kb/')

    let fileBuffer: Buffer

    if (isKBFile) {
      fileBuffer = await downloadKBFile(cloudKey)
    } else if (bucketType === 'copilot') {
      const storageProvider = getStorageProvider()

      if (storageProvider === 's3') {
        const { S3_COPILOT_CONFIG } = await import('@/lib/uploads/setup')
        fileBuffer = await downloadFile(cloudKey, {
          bucket: S3_COPILOT_CONFIG.bucket,
          region: S3_COPILOT_CONFIG.region,
        })
      } else if (storageProvider === 'blob') {
        const { BLOB_COPILOT_CONFIG } = await import('@/lib/uploads/setup')
        fileBuffer = await downloadFile(cloudKey, {
          containerName: BLOB_COPILOT_CONFIG.containerName,
          accountName: BLOB_COPILOT_CONFIG.accountName,
          accountKey: BLOB_COPILOT_CONFIG.accountKey,
          connectionString: BLOB_COPILOT_CONFIG.connectionString,
        })
      } else {
        fileBuffer = await downloadFile(cloudKey)
      }
    } else {
      // Default bucket
      fileBuffer = await downloadFile(cloudKey)
    }

    // Extract the original filename from the key (last part after last /)
    const originalFilename = cloudKey.split('/').pop() || 'download'
    const contentType = getContentType(originalFilename)

    logger.info('Cloud file served', {
      userId,
      key: cloudKey,
      size: fileBuffer.length,
      bucket: bucketType || 'default',
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
