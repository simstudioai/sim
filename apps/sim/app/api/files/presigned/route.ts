import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { CopilotFiles } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/core/config-resolver'
import { USE_BLOB_STORAGE } from '@/lib/uploads/core/setup'
import { generatePresignedUploadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('PresignedUploadAPI')

interface PresignedUrlRequest {
  fileName: string
  contentType: string
  fileSize: number
  userId?: string
  chatId?: string
}

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

class ValidationError extends PresignedUrlError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    if (uploadType === 'knowledge-base') {
      const fileValidationError = validateFileType(fileName, contentType)
      if (fileValidationError) {
        throw new ValidationError(`${fileValidationError.message}`)
      }
    }

    const sessionUserId = session.user.id

    if (!hasCloudStorage()) {
      logger.info(
        `Local storage detected - presigned URL not available for ${fileName}, client will use API fallback`
      )
      return NextResponse.json({
        fileName,
        presignedUrl: '', // Empty URL signals fallback to API upload
        fileInfo: {
          path: '',
          key: '',
          name: fileName,
          size: fileSize,
          type: contentType,
        },
        directUploadSupported: false,
      })
    }

    logger.info(`Generating ${uploadType} presigned URL for ${fileName}`)

    let presignedUrlResponse

    if (uploadType === 'copilot') {
      try {
        presignedUrlResponse = await CopilotFiles.generateCopilotUploadUrl({
          fileName,
          contentType,
          fileSize,
          userId: sessionUserId,
          expirationSeconds: 3600,
        })
      } catch (error) {
        throw new ValidationError(
          error instanceof Error ? error.message : 'Copilot validation failed'
        )
      }
    } else {
      if (uploadType === 'profile-pictures') {
        if (!sessionUserId?.trim()) {
          throw new ValidationError(
            'Authenticated user session is required for profile picture uploads'
          )
        }
        if (!CopilotFiles.isImageFileType(contentType)) {
          throw new ValidationError(
            'Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for profile picture uploads'
          )
        }
      }

      presignedUrlResponse = await generatePresignedUploadUrl({
        fileName,
        contentType,
        fileSize,
        context: uploadType,
        userId: sessionUserId,
        expirationSeconds: 3600, // 1 hour
      })
    }

    // Construct the serve path for later downloads
    // For chat and profile-pictures, we could use direct cloud URLs,
    // but for knowledge-base and others, use the serve API endpoint with context parameter
    const finalPath =
      uploadType === 'chat' || uploadType === 'profile-pictures'
        ? presignedUrlResponse.url.split('?')[0] // Cloud URL without query params
        : `/api/files/serve/${USE_BLOB_STORAGE ? 'blob' : 's3'}/${encodeURIComponent(presignedUrlResponse.key)}?context=${uploadType}`

    return NextResponse.json({
      fileName,
      presignedUrl: presignedUrlResponse.url,
      fileInfo: {
        path: finalPath,
        key: presignedUrlResponse.key,
        name: fileName,
        size: fileSize,
        type: contentType,
      },
      fields: presignedUrlResponse.fields,
      directUploadSupported: true,
    })
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
