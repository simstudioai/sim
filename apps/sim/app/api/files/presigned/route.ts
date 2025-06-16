import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import { getBlobServiceClient } from '@/lib/uploads/blob/blob-client'
import { getS3Client, sanitizeFilenameForMetadata } from '@/lib/uploads/s3/s3-client'
import { BLOB_CONFIG, S3_CONFIG } from '@/lib/uploads/setup'
import { createErrorResponse, createOptionsResponse } from '../utils'

const logger = createLogger('PresignedUploadAPI')

interface PresignedUrlRequest {
  fileName: string
  contentType: string
  fileSize: number
}

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const data: PresignedUrlRequest = await request.json()
    const { fileName, contentType, fileSize } = data

    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'Missing fileName or contentType' }, { status: 400 })
    }

    // Only proceed if cloud storage is enabled
    if (!isUsingCloudStorage()) {
      return NextResponse.json(
        {
          error: 'Direct uploads are only available when cloud storage is enabled',
          directUploadSupported: false,
        },
        { status: 400 }
      )
    }

    const storageProvider = getStorageProvider()

    switch (storageProvider) {
      case 's3':
        return await handleS3PresignedUrl(fileName, contentType, fileSize)
      case 'blob':
        return await handleBlobPresignedUrl(fileName, contentType, fileSize)
      default:
        return NextResponse.json(
          {
            error: 'Unknown storage provider',
            directUploadSupported: false,
          },
          { status: 400 }
        )
    }
  } catch (error) {
    logger.error('Error generating presigned URL:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Failed to generate presigned URL')
    )
  }
}

async function handleS3PresignedUrl(fileName: string, contentType: string, fileSize: number) {
  // Create a unique key for the file
  const safeFileName = fileName.replace(/\s+/g, '-')
  const uniqueKey = `${Date.now()}-${uuidv4()}-${safeFileName}`

  // Sanitize the original filename for S3 metadata to prevent header errors
  const sanitizedOriginalName = sanitizeFilenameForMetadata(fileName)

  // Create the S3 command
  const command = new PutObjectCommand({
    Bucket: S3_CONFIG.bucket,
    Key: uniqueKey,
    ContentType: contentType,
    Metadata: {
      originalName: sanitizedOriginalName,
      uploadedAt: new Date().toISOString(),
    },
  })

  // Generate the presigned URL
  const presignedUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 })

  // Create a path for API to serve the file
  const servePath = `/api/files/serve/s3/${encodeURIComponent(uniqueKey)}`

  logger.info(`Generated presigned URL for ${fileName} (${uniqueKey})`)

  return NextResponse.json({
    presignedUrl,
    fileInfo: {
      path: servePath,
      key: uniqueKey,
      name: fileName,
      size: fileSize,
      type: contentType,
    },
    directUploadSupported: true,
  })
}

async function handleBlobPresignedUrl(fileName: string, contentType: string, fileSize: number) {
  // Create a unique key for the file
  const safeFileName = fileName.replace(/\s+/g, '-')
  const uniqueKey = `${Date.now()}-${uuidv4()}-${safeFileName}`

  try {
    const blobServiceClient = getBlobServiceClient()
    const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

    // Generate SAS token for upload (write permission)
    const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
      await import('@azure/storage-blob')

    const sasOptions = {
      containerName: BLOB_CONFIG.containerName,
      blobName: uniqueKey,
      permissions: BlobSASPermissions.parse('w'), // Write permission for upload
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 3600 * 1000), // 1 hour expiration
    }

    const sasToken = generateBlobSASQueryParameters(
      sasOptions,
      new StorageSharedKeyCredential(BLOB_CONFIG.accountName, BLOB_CONFIG.accountKey || '')
    ).toString()

    const presignedUrl = `${blockBlobClient.url}?${sasToken}`

    // Create a path for API to serve the file
    const servePath = `/api/files/serve/blob/${encodeURIComponent(uniqueKey)}`

    logger.info(`Generated presigned URL for ${fileName} (${uniqueKey})`)

    return NextResponse.json({
      presignedUrl,
      fileInfo: {
        path: servePath,
        key: uniqueKey,
        name: fileName,
        size: fileSize,
        type: contentType,
      },
      directUploadSupported: true,
      uploadHeaders: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-blob-content-type': contentType,
        'x-ms-meta-originalname': encodeURIComponent(fileName),
        'x-ms-meta-uploadedat': new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('Error generating Blob presigned URL:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Failed to generate Blob presigned URL')
    )
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return createOptionsResponse()
}
