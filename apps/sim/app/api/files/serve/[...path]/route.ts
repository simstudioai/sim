import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { createLogger } from '@/lib/logs/console-logger'
import { downloadFromS3, getPresignedUrl } from '@/lib/uploads/s3-client'
import { USE_S3_STORAGE } from '@/lib/uploads/setup'

import '@/lib/uploads/setup.server'
import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
} from '../../utils'

const logger = createLogger('FilesServeAPI')

/**
 * Main API route handler for serving files
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Extract params
    const { path } = await params

    // Join the path segments to get the filename or S3 key
    const pathString = path.join('/')
    logger.info(`Serving file: ${pathString}`)

    // Check if this is an S3 file (path starts with 's3/')
    const isS3Path = path[0] === 's3'

    try {
      // Use S3 handler if in production or path explicitly specifies S3
      if (USE_S3_STORAGE || isS3Path) {
        return await handleS3File(path, isS3Path, pathString)
      }

      // Use local handler for local files
      return await handleLocalFile(path)
    } catch (error) {
      logger.error('Error serving file:', error)
      return createErrorResponse(error as Error)
    }
  } catch (error) {
    logger.error('Error serving file:', error)
    return createErrorResponse(error as Error)
  }
}

/**
 * Handle S3 file serving
 */
async function handleS3File(
  path: string[],
  isS3Path: boolean,
  pathString: string
): Promise<NextResponse> {
  // If path starts with s3/, remove that prefix to get the actual key
  const s3Key = isS3Path ? decodeURIComponent(path.slice(1).join('/')) : pathString
  logger.info(`Serving file from S3: ${s3Key}`)

  try {
    // First try direct access via presigned URL (most efficient)
    return await handleS3PresignedUrl(s3Key)
  } catch (error) {
    logger.info('Falling back to proxy method for S3 file')
    // Fall back to proxy method if presigned URL fails
    return await handleS3Proxy(s3Key)
  }
}

/**
 * Generate a presigned URL and redirect to it
 */
async function handleS3PresignedUrl(s3Key: string): Promise<NextResponse> {
  try {
    // Generate a presigned URL for direct S3 access
    const presignedUrl = await getPresignedUrl(s3Key)

    // Redirect to the presigned URL for direct S3 access
    return NextResponse.redirect(presignedUrl)
  } catch (error) {
    logger.error('Error generating presigned URL:', error)
    throw error
  }
}

/**
 * Proxy S3 file through our server
 */
async function handleS3Proxy(s3Key: string): Promise<NextResponse> {
  try {
    const fileBuffer = await downloadFromS3(s3Key)

    // Extract the original filename from the key (last part after last /)
    const originalFilename = s3Key.split('/').pop() || 'download'
    const contentType = getContentType(originalFilename)

    return createFileResponse({
      buffer: fileBuffer,
      contentType,
      filename: originalFilename,
    })
  } catch (error) {
    logger.error('Error downloading from S3:', error)
    throw error
  }
}

/**
 * Handle local file serving
 */
async function handleLocalFile(path: string[]): Promise<NextResponse> {
  // Join as a path for findLocalFile
  const pathString = path.join('/')
  const filePath = findLocalFile(pathString)

  // Handle file not found
  if (!filePath) {
    logger.error(`File not found in any checked paths for: ${pathString}`)
    throw new FileNotFoundError(`File not found: ${pathString}`)
  }

  // Read the file
  const fileBuffer = await readFile(filePath)

  // Get filename for content type detection and response
  const filename = path[path.length - 1]
  const contentType = getContentType(filename)

  return createFileResponse({
    buffer: fileBuffer,
    contentType,
    filename,
  })
}
