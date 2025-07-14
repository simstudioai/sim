import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import { getBlobServiceClient } from '@/lib/uploads/blob/blob-client'
import { getS3Client, sanitizeFilenameForMetadata } from '@/lib/uploads/s3/s3-client'
import { BLOB_CONFIG, BLOB_KB_CONFIG, S3_CONFIG, S3_KB_CONFIG } from '@/lib/uploads/setup'
import { createErrorResponse, createOptionsResponse } from '@/app/api/files/utils'

const logger = createLogger('PresignedUploadAPI')

interface PresignedUrlRequest {
  fileName: string
  contentType: string
  fileSize: number
}

type UploadType = 'general' | 'knowledge-base'

class PresignedUrlError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 400
  ) {
    super(message)
    this.name = 'PresignedUrlError'
  }
}

class StorageConfigError extends PresignedUrlError {
  constructor(message: string) {
    super(message, 'STORAGE_CONFIG_ERROR', 500)
  }
}

class ValidationError extends PresignedUrlError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export async function POST(request: NextRequest) {
  try {
    let data: PresignedUrlRequest
    try {
      data = await request.json()
    } catch {
      throw new ValidationError('Invalid JSON in request body')
    }

    const { fileName, contentType, fileSize } = data

    if (!fileName?.trim()) {
      throw new ValidationError('fileName is required and cannot be empty')
    }
    if (!contentType?.trim()) {
      throw new ValidationError('contentType is required and cannot be empty')
    }
    if (!fileSize || fileSize <= 0) {
      throw new ValidationError('fileSize must be a positive number')
    }

    const MAX_FILE_SIZE = 100 * 1024 * 1024
    if (fileSize > MAX_FILE_SIZE) {
      throw new ValidationError(
        `File size (${fileSize} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes)`
      )
    }

    const uploadTypeParam = request.nextUrl.searchParams.get('type')
    const uploadType: UploadType =
      uploadTypeParam === 'knowledge-base' ? 'knowledge-base' : 'general'

    if (!isUsingCloudStorage()) {
      throw new StorageConfigError(
        'Direct uploads are only available when cloud storage is enabled'
      )
    }

    const storageProvider = getStorageProvider()
    logger.info(`Generating ${uploadType} presigned URL for ${fileName} using ${storageProvider}`)

    switch (storageProvider) {
      case 's3':
        return await handleS3PresignedUrl(fileName, contentType, fileSize, uploadType)
      case 'blob':
        return await handleBlobPresignedUrl(fileName, contentType, fileSize, uploadType)
      default:
        throw new StorageConfigError(`Unknown storage provider: ${storageProvider}`)
    }
  } catch (error) {
    logger.error('Error generating presigned URL:', error)

    if (error instanceof PresignedUrlError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          directUploadSupported: false,
        },
        { status: error.statusCode }
      )
    }

    return createErrorResponse(
      error instanceof Error ? error : new Error('Failed to generate presigned URL')
    )
  }
}

async function handleS3PresignedUrl(
  fileName: string,
  contentType: string,
  fileSize: number,
  uploadType: UploadType
) {
  try {
    const config = uploadType === 'knowledge-base' ? S3_KB_CONFIG : S3_CONFIG

    if (!config.bucket || !config.region) {
      throw new StorageConfigError(`S3 configuration missing for ${uploadType} uploads`)
    }

    const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
    const prefix = uploadType === 'knowledge-base' ? 'kb/' : ''
    const uniqueKey = `${prefix}${Date.now()}-${uuidv4()}-${safeFileName}`

    const sanitizedOriginalName = sanitizeFilenameForMetadata(fileName)

    const metadata: Record<string, string> = {
      originalName: sanitizedOriginalName,
      uploadedAt: new Date().toISOString(),
    }

    if (uploadType === 'knowledge-base') {
      metadata.purpose = 'knowledge-base'
    }

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: uniqueKey,
      ContentType: contentType,
      Metadata: metadata,
    })

    let presignedUrl: string
    try {
      presignedUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 })
    } catch (s3Error) {
      logger.error('Failed to generate S3 presigned URL:', s3Error)
      throw new StorageConfigError(
        'Failed to generate S3 presigned URL - check AWS credentials and permissions'
      )
    }

    const servePath = `/api/files/serve/s3/${encodeURIComponent(uniqueKey)}`

    logger.info(`Generated ${uploadType} S3 presigned URL for ${fileName} (${uniqueKey})`)

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
  } catch (error) {
    if (error instanceof PresignedUrlError) {
      throw error
    }
    logger.error('Error in S3 presigned URL generation:', error)
    throw new StorageConfigError('Failed to generate S3 presigned URL')
  }
}

async function handleBlobPresignedUrl(
  fileName: string,
  contentType: string,
  fileSize: number,
  uploadType: UploadType
) {
  try {
    const config = uploadType === 'knowledge-base' ? BLOB_KB_CONFIG : BLOB_CONFIG

    if (
      !config.accountName ||
      !config.containerName ||
      (!config.accountKey && !config.connectionString)
    ) {
      throw new StorageConfigError(`Azure Blob configuration missing for ${uploadType} uploads`)
    }

    const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
    const prefix = uploadType === 'knowledge-base' ? 'kb/' : ''
    const uniqueKey = `${prefix}${Date.now()}-${uuidv4()}-${safeFileName}`

    const blobServiceClient = getBlobServiceClient()
    const containerClient = blobServiceClient.getContainerClient(config.containerName)
    const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

    const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
      await import('@azure/storage-blob')

    const sasOptions = {
      containerName: config.containerName,
      blobName: uniqueKey,
      permissions: BlobSASPermissions.parse('w'), // Write permission for upload
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 3600 * 1000), // 1 hour expiration
    }

    let sasToken: string
    try {
      sasToken = generateBlobSASQueryParameters(
        sasOptions,
        new StorageSharedKeyCredential(config.accountName, config.accountKey || '')
      ).toString()
    } catch (blobError) {
      logger.error('Failed to generate Azure Blob SAS token:', blobError)
      throw new StorageConfigError(
        'Failed to generate Azure Blob SAS token - check Azure credentials and permissions'
      )
    }

    const presignedUrl = `${blockBlobClient.url}?${sasToken}`

    const servePath = `/api/files/serve/blob/${encodeURIComponent(uniqueKey)}`

    logger.info(`Generated ${uploadType} Azure Blob presigned URL for ${fileName} (${uniqueKey})`)

    const uploadHeaders: Record<string, string> = {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-blob-content-type': contentType,
      'x-ms-meta-originalname': encodeURIComponent(fileName),
      'x-ms-meta-uploadedat': new Date().toISOString(),
    }

    if (uploadType === 'knowledge-base') {
      uploadHeaders['x-ms-meta-purpose'] = 'knowledge-base'
    }

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
      uploadHeaders,
    })
  } catch (error) {
    if (error instanceof PresignedUrlError) {
      throw error
    }
    logger.error('Error in Azure Blob presigned URL generation:', error)
    throw new StorageConfigError('Failed to generate Azure Blob presigned URL')
  }
}

export async function OPTIONS() {
  return createOptionsResponse()
}
