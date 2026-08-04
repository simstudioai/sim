import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  batchPresignedUploadBodyContract,
  batchPresignedUploadTypeSchema,
  batchPresignedUploadTypes,
} from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import {
  generateBatchPresignedUploadUrls,
  hasCloudStorage,
} from '@/lib/uploads/core/storage-service'
import { recordKnowledgeBaseFileOwnershipMany } from '@/lib/uploads/server/metadata'
import { validateFileType } from '@/lib/uploads/utils/validation'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('BatchPresignedUploadAPI')

/**
 * Mints presigned upload URLs for knowledge-base ingest, the only context this
 * endpoint can authorize. Every request must name a workspace the caller has
 * write access to; other storage contexts are rejected rather than presigned,
 * because a presigned PUT is a write grant into a bucket served from a trusted
 * origin.
 */
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

    const uploadTypeResult = batchPresignedUploadTypeSchema.safeParse(uploadTypeParam)
    if (!uploadTypeResult.success) {
      return NextResponse.json(
        {
          error: `Invalid type parameter. Must be one of: ${batchPresignedUploadTypes.join(', ')}`,
        },
        { status: 400 }
      )
    }

    const uploadType = uploadTypeResult.data
    const sessionUserId = session.user.id

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

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId?.trim()) {
      return NextResponse.json(
        { error: 'workspaceId query parameter is required for knowledge-base uploads' },
        { status: 400 }
      )
    }

    const permission = await getUserEntityPermissions(sessionUserId, 'workspace', workspaceId)
    if (permission !== 'write' && permission !== 'admin') {
      return NextResponse.json(
        { error: 'Write or Admin access required for knowledge-base uploads' },
        { status: 403 }
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

    await recordKnowledgeBaseFileOwnershipMany(
      presignedUrls.map((urlResponse, index) => ({
        key: urlResponse.key,
        userId: sessionUserId,
        workspaceId,
        originalName: files[index].fileName,
        contentType: files[index].contentType,
        size: files[index].fileSize,
      }))
    )

    const storagePrefix = getServeStoragePrefix()

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
