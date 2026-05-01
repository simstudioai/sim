import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1ListFilesContract, v1UploadFileFormFieldsSchema } from '@/lib/api/contracts/v1/files'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  FileConflictError,
  getWorkspaceFile,
  listWorkspaceFiles,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import {
  checkRateLimit,
  checkWorkspaceScope,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1FilesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

/** GET /api/v1/files — List all files in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1ListFilesContract, request, {})
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    const files = await listWorkspaceFiles(workspaceId)

    return NextResponse.json({
      success: true,
      data: {
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          type: f.type,
          key: f.key,
          uploadedBy: f.uploadedBy,
          uploadedAt:
            f.uploadedAt instanceof Date ? f.uploadedAt.toISOString() : String(f.uploadedAt),
        })),
        totalCount: files.length,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error listing files:`, error)
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 })
  }
})

/** POST /api/v1/files — Upload a file to a workspace. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid multipart form data' },
        { status: 400 }
      )
    }
    const rawFile = formData.get('file')
    const file = rawFile instanceof File ? rawFile : null
    const rawWorkspaceId = formData.get('workspaceId')
    const formFieldsResult = v1UploadFileFormFieldsSchema.safeParse({
      workspaceId: typeof rawWorkspaceId === 'string' ? rawWorkspaceId : '',
    })

    if (!formFieldsResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(formFieldsResult.error, 'Invalid form data') },
        { status: 400 }
      )
    }
    const { workspaceId } = formFieldsResult.data

    const scopeError = checkWorkspaceScope(rateLimit, workspaceId)
    if (scopeError) return scopeError

    if (!file) {
      return NextResponse.json({ error: 'file form field is required' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File size exceeds 100MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)`,
        },
        { status: 400 }
      )
    }

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const buffer = Buffer.from(await file.arrayBuffer())

    const userFile = await uploadWorkspaceFile(
      workspaceId,
      userId,
      buffer,
      file.name,
      file.type || 'application/octet-stream'
    )

    logger.info(`[${requestId}] Uploaded file: ${file.name} to workspace ${workspaceId}`)

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FILE_UPLOADED,
      resourceType: AuditResourceType.FILE,
      resourceId: userFile.id,
      resourceName: file.name,
      description: `Uploaded file "${file.name}" via API`,
      metadata: { fileSize: file.size, fileType: file.type || 'application/octet-stream' },
      request,
    })

    const fileRecord = await getWorkspaceFile(workspaceId, userFile.id)
    const uploadedAt =
      fileRecord?.uploadedAt instanceof Date
        ? fileRecord.uploadedAt.toISOString()
        : fileRecord?.uploadedAt
          ? String(fileRecord.uploadedAt)
          : new Date().toISOString()

    return NextResponse.json({
      success: true,
      data: {
        file: {
          id: userFile.id,
          name: userFile.name,
          size: userFile.size,
          type: userFile.type,
          key: userFile.key,
          uploadedBy: userId,
          uploadedAt,
        },
        message: 'File uploaded successfully',
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to upload file'
    const isDuplicate =
      error instanceof FileConflictError || errorMessage.includes('already exists')

    if (isDuplicate) {
      return NextResponse.json({ error: errorMessage }, { status: 409 })
    }

    logger.error(`[${requestId}] Error uploading file:`, error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
})
