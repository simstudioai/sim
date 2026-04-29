import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { presignedUrlBodySchema, uploadTypeSchema } from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CopilotFiles } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
import { generatePresignedUploadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('PresignedUploadAPI')

const MAX_FILE_SIZE = 100 * 1024 * 1024
const VALID_UPLOAD_TYPES = ['knowledge-base', 'chat', 'copilot', 'profile-pictures'] as const

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

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let rawData: unknown
    try {
      rawData = await request.json()
    } catch {
      throw new ValidationError('Invalid JSON in request body')
    }

    const validationResult = presignedUrlBodySchema.safeParse(rawData)
    if (!validationResult.success) {
      throw new ValidationError(
        getValidationErrorMessage(validationResult.error, 'Invalid request data')
      )
    }

    const data = validationResult.data
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

    if (fileSize > MAX_FILE_SIZE) {
      throw new ValidationError(
        `File size (${fileSize} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes)`
      )
    }

    const uploadTypeParam = request.nextUrl.searchParams.get('type')
    if (!uploadTypeParam) {
      throw new ValidationError('type query parameter is required')
    }

    const uploadTypeResult = uploadTypeSchema.safeParse(uploadTypeParam)
    if (!uploadTypeResult.success) {
      throw new ValidationError(
        `Invalid type parameter. Must be one of: ${VALID_UPLOAD_TYPES.join(', ')}`
      )
    }

    const uploadType = uploadTypeResult.data as StorageContext

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
        if (!isImageFileType(contentType)) {
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

    const finalPath = `/api/files/serve/${USE_BLOB_STORAGE ? 'blob' : 's3'}/${encodeURIComponent(presignedUrlResponse.key)}?context=${uploadType}`

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
      uploadHeaders: presignedUrlResponse.uploadHeaders,
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
})

export const OPTIONS = withRouteHandler(async () => {
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
})
