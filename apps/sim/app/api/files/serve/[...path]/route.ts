import { readFile } from 'fs/promises'
import type { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { downloadFile, isUsingCloudStorage } from '@/lib/uploads'
import '@/lib/uploads/setup.server'

import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
} from '../../utils'

export const dynamic = 'force-dynamic'

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
      return await handleCloudProxy(cloudKey)
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

/**
 * Proxy cloud file through our server
 */
async function handleCloudProxy(cloudKey: string): Promise<NextResponse> {
  try {
    const fileBuffer = await downloadFile(cloudKey)

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
