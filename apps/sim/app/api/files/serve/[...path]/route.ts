import { readFile } from 'fs/promises'
import type { NextRequest, NextResponse } from 'next/server'
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

/**
 * Main API route handler for serving files
 */
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

    // Join the path segments to get the filename or cloud key
    const fullPath = path.join('/')

    // Check if this is a cloud file (path starts with 's3/' or 'blob/')
    const isS3Path = path[0] === 's3'
    const isBlobPath = path[0] === 'blob'
    const isCloudPath = isS3Path || isBlobPath

    // Use cloud handler if in production, path explicitly specifies cloud storage, or we're using cloud storage
    if (isUsingCloudStorage() || isCloudPath) {
      // Extract the actual key (remove 's3/' or 'blob/' prefix if present)
      const cloudKey = isCloudPath ? path.slice(1).join('/') : fullPath

      // Get bucket type from query parameter
      const bucketType = request.nextUrl.searchParams.get('bucket')

      return await handleCloudProxy(cloudKey, bucketType)
    }

    // Use local handler for local files
    return await handleLocalFile(fullPath)
  } catch (error) {
    logger.error('Error serving file:', error)

    if (error instanceof FileNotFoundError) {
      return createErrorResponse(error)
    }

    return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
  }
}

/**
 * Handle local file serving
 */
async function handleLocalFile(filename: string): Promise<NextResponse> {
  try {
    const filePath = findLocalFile(filename)

    if (!filePath) {
      throw new FileNotFoundError(`File not found: ${filename}`)
    }

    const fileBuffer = await readFile(filePath)
    const contentType = getContentType(filename)

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

/**
 * Proxy cloud file through our server
 */
async function handleCloudProxy(
  cloudKey: string,
  bucketType?: string | null
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
