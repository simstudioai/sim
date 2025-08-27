import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getStorageProvider, isUsingCloudStorage } from '@/lib/uploads'
import {
  BLOB_CHAT_CONFIG,
  BLOB_CONFIG,
  BLOB_COPILOT_CONFIG,
  BLOB_KB_CONFIG,
  S3_CHAT_CONFIG,
  S3_CONFIG,
  S3_COPILOT_CONFIG,
  S3_KB_CONFIG,
} from '@/lib/uploads/setup'
import { validateFileType } from '@/lib/uploads/validation'
import { createErrorResponse, createOptionsResponse } from '@/app/api/files/utils'

const logger = createLogger('BatchPresignedUploadAPI')

interface BatchFileRequest {
  fileName: string
  contentType: string
  fileSize: number
}

interface BatchPresignedUrlRequest {
  files: BatchFileRequest[]
}

type UploadType = 'general' | 'knowledge-base' | 'chat' | 'copilot'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let data: BatchPresignedUrlRequest
    try {
      data = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    const { files } = data

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { error: 'files array is required and cannot be empty' },
        { status: 400 }
      )
    }

    if (files.length > 100) {
      return NextResponse.json(
        { error: 'Cannot process more than 100 files at once' },
        { status: 400 }
      )
    }

    const uploadTypeParam = request.nextUrl.searchParams.get('type')
    const uploadType: UploadType =
      uploadTypeParam === 'knowledge-base'
        ? 'knowledge-base'
        : uploadTypeParam === 'chat'
          ? 'chat'
          : uploadTypeParam === 'copilot'
            ? 'copilot'
            : 'general'

    const MAX_FILE_SIZE = 100 * 1024 * 1024
    for (const file of files) {
      if (!file.fileName?.trim()) {
        return NextResponse.json({ error: 'fileName is required for all files' }, { status: 400 })
      }
      if (!file.contentType?.trim()) {
        return NextResponse.json(
          { error: 'contentType is required for all files' },
          { status: 400 }
        )
      }
      if (!file.fileSize || file.fileSize <= 0) {
        return NextResponse.json(
          { error: 'fileSize must be positive for all files' },
          { status: 400 }
        )
      }
      if (file.fileSize > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File ${file.fileName} exceeds maximum size of ${MAX_FILE_SIZE} bytes` },
          { status: 400 }
        )
      }

      if (uploadType === 'knowledge-base') {
        const fileValidationError = validateFileType(file.fileName, file.contentType)
        if (fileValidationError) {
          return NextResponse.json(
            {
              error: fileValidationError.message,
              code: fileValidationError.code,
              supportedTypes: fileValidationError.supportedTypes,
            },
            { status: 400 }
          )
        }
      }
    }

    const sessionUserId = session.user.id

    if (uploadType === 'copilot' && !sessionUserId?.trim()) {
      return NextResponse.json(
        { error: 'Authenticated user session is required for copilot uploads' },
        { status: 400 }
      )
    }

    if (!isUsingCloudStorage()) {
      return NextResponse.json(
        { error: 'Direct uploads are only available when cloud storage is enabled' },
        { status: 400 }
      )
    }

    const storageProvider = getStorageProvider()
    logger.info(
      `Generating batch ${uploadType} presigned URLs for ${files.length} files using ${storageProvider}`
    )

    const startTime = Date.now()

    let result
    switch (storageProvider) {
      case 's3':
        result = await handleBatchS3PresignedUrls(files, uploadType, sessionUserId)
        break
      case 'blob':
        result = await handleBatchBlobPresignedUrls(files, uploadType, sessionUserId)
        break
      default:
        return NextResponse.json(
          { error: `Unknown storage provider: ${storageProvider}` },
          { status: 500 }
        )
    }

    const duration = Date.now() - startTime
    logger.info(
      `Generated ${files.length} presigned URLs in ${duration}ms (avg ${Math.round(duration / files.length)}ms per file)`
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Error generating batch presigned URLs:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Failed to generate batch presigned URLs')
    )
  }
}

async function handleBatchS3PresignedUrls(
  files: BatchFileRequest[],
  uploadType: UploadType,
  userId?: string
) {
  const config =
    uploadType === 'knowledge-base'
      ? S3_KB_CONFIG
      : uploadType === 'chat'
        ? S3_CHAT_CONFIG
        : uploadType === 'copilot'
          ? S3_COPILOT_CONFIG
          : S3_CONFIG

  if (!config.bucket || !config.region) {
    throw new Error(`S3 configuration missing for ${uploadType} uploads`)
  }

  const { getS3Client, sanitizeFilenameForMetadata } = await import('@/lib/uploads/s3/s3-client')
  const s3Client = getS3Client()

  let prefix = ''
  if (uploadType === 'knowledge-base') {
    prefix = 'kb/'
  } else if (uploadType === 'chat') {
    prefix = 'chat/'
  } else if (uploadType === 'copilot') {
    prefix = `${userId}/`
  }

  const baseMetadata: Record<string, string> = {
    uploadedAt: new Date().toISOString(),
  }

  if (uploadType === 'knowledge-base') {
    baseMetadata.purpose = 'knowledge-base'
  } else if (uploadType === 'chat') {
    baseMetadata.purpose = 'chat'
  } else if (uploadType === 'copilot') {
    baseMetadata.purpose = 'copilot'
    baseMetadata.userId = userId || ''
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const safeFileName = file.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
      const uniqueKey = `${prefix}${uuidv4()}-${safeFileName}`
      const sanitizedOriginalName = sanitizeFilenameForMetadata(file.fileName)

      const metadata = {
        ...baseMetadata,
        originalName: sanitizedOriginalName,
      }

      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: uniqueKey,
        ContentType: file.contentType,
        Metadata: metadata,
      })

      const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 })

      const finalPath =
        uploadType === 'chat'
          ? `https://${config.bucket}.s3.${config.region}.amazonaws.com/${uniqueKey}`
          : `/api/files/serve/s3/${encodeURIComponent(uniqueKey)}`

      return {
        fileName: file.fileName,
        presignedUrl,
        fileInfo: {
          path: finalPath,
          key: uniqueKey,
          name: file.fileName,
          size: file.fileSize,
          type: file.contentType,
        },
      }
    })
  )

  return {
    files: results,
    directUploadSupported: true,
  }
}

async function handleBatchBlobPresignedUrls(
  files: BatchFileRequest[],
  uploadType: UploadType,
  userId?: string
) {
  const config =
    uploadType === 'knowledge-base'
      ? BLOB_KB_CONFIG
      : uploadType === 'chat'
        ? BLOB_CHAT_CONFIG
        : uploadType === 'copilot'
          ? BLOB_COPILOT_CONFIG
          : BLOB_CONFIG

  if (
    !config.accountName ||
    !config.containerName ||
    (!config.accountKey && !config.connectionString)
  ) {
    throw new Error(`Azure Blob configuration missing for ${uploadType} uploads`)
  }

  const { getBlobServiceClient } = await import('@/lib/uploads/blob/blob-client')
  const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
    await import('@azure/storage-blob')

  const blobServiceClient = getBlobServiceClient()
  const containerClient = blobServiceClient.getContainerClient(config.containerName)

  let prefix = ''
  if (uploadType === 'knowledge-base') {
    prefix = 'kb/'
  } else if (uploadType === 'chat') {
    prefix = 'chat/'
  } else if (uploadType === 'copilot') {
    prefix = `${userId}/`
  }

  const baseUploadHeaders: Record<string, string> = {
    'x-ms-blob-type': 'BlockBlob',
    'x-ms-meta-uploadedat': new Date().toISOString(),
  }

  if (uploadType === 'knowledge-base') {
    baseUploadHeaders['x-ms-meta-purpose'] = 'knowledge-base'
  } else if (uploadType === 'chat') {
    baseUploadHeaders['x-ms-meta-purpose'] = 'chat'
  } else if (uploadType === 'copilot') {
    baseUploadHeaders['x-ms-meta-purpose'] = 'copilot'
    baseUploadHeaders['x-ms-meta-userid'] = encodeURIComponent(userId || '')
  }

  const results = await Promise.all(
    files.map(async (file) => {
      const safeFileName = file.fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
      const uniqueKey = `${prefix}${uuidv4()}-${safeFileName}`
      const blockBlobClient = containerClient.getBlockBlobClient(uniqueKey)

      const sasOptions = {
        containerName: config.containerName,
        blobName: uniqueKey,
        permissions: BlobSASPermissions.parse('w'),
        startsOn: new Date(),
        expiresOn: new Date(Date.now() + 3600 * 1000),
      }

      const sasToken = generateBlobSASQueryParameters(
        sasOptions,
        new StorageSharedKeyCredential(config.accountName, config.accountKey || '')
      ).toString()

      const presignedUrl = `${blockBlobClient.url}?${sasToken}`

      const finalPath =
        uploadType === 'chat'
          ? blockBlobClient.url
          : `/api/files/serve/blob/${encodeURIComponent(uniqueKey)}`

      const uploadHeaders = {
        ...baseUploadHeaders,
        'x-ms-blob-content-type': file.contentType,
        'x-ms-meta-originalname': encodeURIComponent(file.fileName),
      }

      return {
        fileName: file.fileName,
        presignedUrl,
        fileInfo: {
          path: finalPath,
          key: uniqueKey,
          name: file.fileName,
          size: file.fileSize,
          type: file.contentType,
        },
        uploadHeaders,
      }
    })
  )

  return {
    files: results,
    directUploadSupported: true,
  }
}

export async function OPTIONS() {
  return createOptionsResponse()
}
