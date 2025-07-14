import { readFile } from 'fs/promises'
import type { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { downloadFile, getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import { BLOB_KB_CONFIG, S3_KB_CONFIG } from '@/lib/uploads/setup'
import '@/lib/uploads/setup.server'

import {
  createErrorResponse,
  createFileResponse,
  FileNotFoundError,
  findLocalFile,
  getContentType,
} from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('FilesServeAPI')

async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data))
    })
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    readableStream.on('error', reject)
  })
}

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

async function downloadKBFile(cloudKey: string): Promise<Buffer> {
  const storageProvider = getStorageProvider()

  if (storageProvider === 'blob') {
    logger.info(`Downloading KB file from Azure Blob Storage: ${cloudKey}`)
    // Use KB-specific blob configuration
    const { getBlobServiceClient } = await import('@/lib/uploads/blob/blob-client')
    const blobServiceClient = getBlobServiceClient()
    const containerClient = blobServiceClient.getContainerClient(BLOB_KB_CONFIG.containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(cloudKey)

    const downloadBlockBlobResponse = await blockBlobClient.download()
    if (!downloadBlockBlobResponse.readableStreamBody) {
      throw new Error('Failed to get readable stream from blob download')
    }

    // Convert stream to buffer
    return await streamToBuffer(downloadBlockBlobResponse.readableStreamBody)
  }

  if (storageProvider === 's3') {
    logger.info(`Downloading KB file from S3: ${cloudKey}`)
    // Use KB-specific S3 configuration
    const { getS3Client } = await import('@/lib/uploads/s3/s3-client')
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')

    const s3Client = getS3Client()
    const command = new GetObjectCommand({
      Bucket: S3_KB_CONFIG.bucket,
      Key: cloudKey,
    })

    const response = await s3Client.send(command)
    if (!response.Body) {
      throw new Error('No body in S3 response')
    }

    // Convert stream to buffer using the same method as the regular S3 client
    const stream = response.Body as any
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks)))
      stream.on('error', reject)
    })
  }

  throw new Error(`Unsupported storage provider for KB files: ${storageProvider}`)
}

/**
 * Proxy cloud file through our server
 */
async function handleCloudProxy(cloudKey: string): Promise<NextResponse> {
  try {
    // Check if this is a KB file (starts with 'kb/')
    const isKBFile = cloudKey.startsWith('kb/')

    const fileBuffer = isKBFile ? await downloadKBFile(cloudKey) : await downloadFile(cloudKey)

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
