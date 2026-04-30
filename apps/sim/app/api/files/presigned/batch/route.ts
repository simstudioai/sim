import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  batchPresignedUploadBodyContract,
  uploadTypeSchema,
} from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { StorageContext } from '@/lib/uploads/config'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
import {
  generateBatchPresignedUploadUrls,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('BatchPresignedUploadAPI')

const VALID_UPLOAD_TYPES = ['knowledge-base', 'chat', 'copilot', 'profile-pictures'] as const

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(
      batchPresignedUploadBodyContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { error: getValidationErrorMessage(error, 'Invalid request data') },
            { status: 400 }
          ),
        invalidJsonResponse: () =>
          NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 }),
      }
    )
    if (!parsed.success) return parsed.response

    const { files } = parsed.data.body

    const uploadTypeParam = request.nextUrl.searchParams.get('type')
    if (!uploadTypeParam) {
      return NextResponse.json({ error: 'type query parameter is required' }, { status: 400 })
    }

    const uploadTypeResult = uploadTypeSchema.safeParse(uploadTypeParam)
    if (!uploadTypeResult.success) {
      return NextResponse.json(
        { error: `Invalid type parameter. Must be one of: ${VALID_UPLOAD_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const uploadType = uploadTypeResult.data as StorageContext

    if (uploadType === 'knowledge-base') {
      for (const file of files) {
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
        const finalPath = `/api/files/serve/${storagePrefix}/${encodeURIComponent(urlResponse.key)}?context=${uploadType}`
        const file = files[index]

        return {
          fileName: file.fileName,
          presignedUrl: urlResponse.url,
          fileInfo: {
            path: finalPath,
            key: urlResponse.key,
            name: file.fileName,
            size: file.fileSize,
            type: file.contentType,
          },
          uploadHeaders: urlResponse.uploadHeaders,
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
