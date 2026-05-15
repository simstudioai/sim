import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { presignedUploadBodyContract, uploadTypeSchema } from '@/lib/api/contracts/storage-transfer'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CopilotFiles } from '@/lib/uploads'
import type { StorageContext } from '@/lib/uploads/config'
import { USE_BLOB_STORAGE } from '@/lib/uploads/config'
import { generateExecutionFileKey } from '@/lib/uploads/contexts/execution/utils'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { generatePresignedUploadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import { insertFileMetadata } from '@/lib/uploads/server/metadata'
import { isImageFileType } from '@/lib/uploads/utils/file-utils'
import { validateAttachmentFileType, validateFileType } from '@/lib/uploads/utils/validation'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { createErrorResponse } from '@/app/api/files/utils'

const logger = createLogger('PresignedUploadAPI')

const VALID_UPLOAD_TYPES = [
  'knowledge-base',
  'chat',
  'copilot',
  'profile-pictures',
  'mothership',
  'workspace-logos',
  'execution',
] as const

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

    const parsed = await parseRequest(
      presignedUploadBodyContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          throw new ValidationError(getValidationErrorMessage(error, 'Invalid request data'))
        },
        invalidJsonResponse: () => {
          throw new ValidationError('Invalid JSON in request body')
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { fileName, contentType, fileSize } = parsed.data.body

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
        throw new ValidationError(getErrorMessage(error, 'Copilot validation failed'))
      }
    } else if (uploadType === 'mothership') {
      const workspaceId = request.nextUrl.searchParams.get('workspaceId')
      if (!workspaceId?.trim()) {
        throw new ValidationError('workspaceId query parameter is required for mothership uploads')
      }

      const permission = await getUserEntityPermissions(sessionUserId, 'workspace', workspaceId)
      if (permission !== 'write' && permission !== 'admin') {
        return NextResponse.json(
          { error: 'Write or Admin access required for mothership uploads' },
          { status: 403 }
        )
      }

      const fileValidationError = validateAttachmentFileType(fileName)
      if (fileValidationError) {
        throw new ValidationError(fileValidationError.message)
      }

      const customKey = generateWorkspaceFileKey(workspaceId, fileName)
      presignedUrlResponse = await generatePresignedUploadUrl({
        fileName,
        contentType,
        fileSize,
        context: 'mothership',
        userId: sessionUserId,
        customKey,
        expirationSeconds: 3600,
        metadata: { workspaceId },
      })

      await insertFileMetadata({
        key: presignedUrlResponse.key,
        userId: sessionUserId,
        workspaceId,
        context: 'mothership',
        originalName: fileName,
        contentType,
        size: fileSize,
      })
    } else if (uploadType === 'execution') {
      const workflowId = request.nextUrl.searchParams.get('workflowId')
      const executionId = request.nextUrl.searchParams.get('executionId')
      const workspaceId = request.nextUrl.searchParams.get('workspaceId')
      if (!workflowId?.trim() || !executionId?.trim() || !workspaceId?.trim()) {
        throw new ValidationError(
          'workflowId, executionId, and workspaceId query parameters are required for execution uploads'
        )
      }

      const permission = await getUserEntityPermissions(sessionUserId, 'workspace', workspaceId)
      if (permission !== 'write' && permission !== 'admin') {
        return NextResponse.json(
          { error: 'Write or Admin access required for execution uploads' },
          { status: 403 }
        )
      }

      const fileValidationError = validateAttachmentFileType(fileName)
      if (fileValidationError) {
        throw new ValidationError(fileValidationError.message)
      }

      const customKey = generateExecutionFileKey({ workspaceId, workflowId, executionId }, fileName)
      presignedUrlResponse = await generatePresignedUploadUrl({
        fileName,
        contentType,
        fileSize,
        context: 'execution',
        userId: sessionUserId,
        customKey,
        expirationSeconds: 3600,
        metadata: { workspaceId, workflowId, executionId },
      })

      await insertFileMetadata({
        key: presignedUrlResponse.key,
        userId: sessionUserId,
        workspaceId,
        context: 'execution',
        originalName: fileName,
        contentType,
        size: fileSize,
      })
    } else if (uploadType === 'workspace-logos') {
      const workspaceId = request.nextUrl.searchParams.get('workspaceId')
      if (!workspaceId?.trim()) {
        throw new ValidationError(
          'workspaceId query parameter is required for workspace-logos uploads'
        )
      }

      const permission = await getUserEntityPermissions(sessionUserId, 'workspace', workspaceId)
      if (permission !== 'admin') {
        return NextResponse.json(
          { error: 'Admin access required for workspace logo uploads' },
          { status: 403 }
        )
      }

      if (!isImageFileType(contentType)) {
        throw new ValidationError(
          'Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for workspace logo uploads'
        )
      }

      presignedUrlResponse = await generatePresignedUploadUrl({
        fileName,
        contentType,
        fileSize,
        context: 'workspace-logos',
        userId: sessionUserId,
        expirationSeconds: 3600,
        metadata: { workspaceId },
      })

      await insertFileMetadata({
        key: presignedUrlResponse.key,
        userId: sessionUserId,
        workspaceId,
        context: 'workspace-logos',
        originalName: fileName,
        contentType,
        size: fileSize,
      })
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
