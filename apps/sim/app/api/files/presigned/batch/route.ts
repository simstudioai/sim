import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { USE_BLOB_STORAGE } from '@/lib/uploads/core/setup'
import {
  generateBatchPresignedUploadUrls,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('BatchPresignedUploadAPI')

interface BatchFileRequest {
  fileName: string
  contentType: string
  fileSize: number
}

interface BatchPresignedUrlRequest {
  files: BatchFileRequest[]
}

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
    const uploadType: StorageContext =
      uploadTypeParam === 'knowledge-base'
        ? 'knowledge-base'
        : uploadTypeParam === 'chat'
          ? 'chat'
          : uploadTypeParam === 'copilot'
            ? 'copilot'
            : uploadTypeParam === 'profile-pictures'
              ? 'profile-pictures'
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

    if (!hasCloudStorage()) {
      logger.info(
        `Local storage detected - batch presigned URLs not available, client will use API fallback`
      )
      return NextResponse.json({
        files: files.map((file) => ({
          fileName: file.fileName,
          presignedUrl: '', // Empty URL signals fallback to API upload
          fileInfo: {
            path: '',
            key: '',
            name: file.fileName,
            size: file.fileSize,
            type: file.contentType,
          },
          directUploadSupported: false,
        })),
        directUploadSupported: false,
      })
    }

    logger.info(`Generating batch ${uploadType} presigned URLs for ${files.length} files`)

    const startTime = Date.now()

    const presignedUrls = await generateBatchPresignedUploadUrls(
      files.map((file) => ({
        fileName: file.fileName,
        contentType: file.contentType,
        fileSize: file.fileSize,
      })),
      uploadType,
      sessionUserId,
      3600 // 1 hour
    )

    const duration = Date.now() - startTime
    logger.info(
      `Generated ${files.length} presigned URLs in ${duration}ms (avg ${Math.round(duration / files.length)}ms per file)`
    )

    const storagePrefix = USE_BLOB_STORAGE ? 'blob' : 's3'

    return NextResponse.json({
      files: presignedUrls.map((urlResponse, index) => {
        // Construct the serve path for later downloads
        // For chat and profile-pictures, use direct cloud URLs,
        // but for knowledge-base and others, use the serve API endpoint with context parameter
        const finalPath =
          uploadType === 'chat' || uploadType === 'profile-pictures'
            ? urlResponse.url.split('?')[0] // Cloud URL without query params
            : `/api/files/serve/${storagePrefix}/${encodeURIComponent(urlResponse.key)}?context=${uploadType}`

        return {
          fileName: files[index].fileName,
          presignedUrl: urlResponse.url,
          fileInfo: {
            path: finalPath,
            key: urlResponse.key,
            name: files[index].fileName,
            size: files[index].fileSize,
            type: files[index].contentType,
          },
          fields: urlResponse.fields,
          directUploadSupported: true,
        }
      }),
      directUploadSupported: true,
    })
  } catch (error) {
    logger.error('Error generating batch presigned URLs:', error)
    return createErrorResponse(
      error instanceof Error ? error : new Error('Failed to generate batch presigned URLs')
    )
  }
}

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    }
  )
}
