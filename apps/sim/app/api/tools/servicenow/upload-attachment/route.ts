import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { servicenowUploadAttachmentContract } from '@/lib/api/contracts/tools/servicenow'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { ServiceNowAttachment } from '@/tools/servicenow/types'
import { createBasicAuthHeader } from '@/tools/servicenow/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ServiceNowUploadAttachmentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized ServiceNow upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(servicenowUploadAttachmentContract, request, {})
    if (!parsed.success) return parsed.response
    const body = parsed.data.body

    if (!body.file) {
      return NextResponse.json({ success: false, error: 'A file is required' }, { status: 400 })
    }

    let userFile
    try {
      userFile = processSingleFileToUserFile(body.file, requestId, logger)
    } catch (error) {
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to process file') },
        { status: 400 }
      )
    }

    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    let fileBuffer: Buffer
    let resolvedContentType: string
    try {
      const servable = await downloadServableFileFromStorage(userFile, requestId, logger)
      fileBuffer = servable.buffer
      resolvedContentType = servable.contentType
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      logger.error(`[${requestId}] Failed to download file from storage:`, error)
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to download file') },
        { status: 500 }
      )
    }

    const contentType = resolvedContentType || userFile.type || 'application/octet-stream'

    const baseUrl = body.instanceUrl.trim().replace(/\/$/, '')
    const uploadParams = new URLSearchParams({
      table_name: body.tableName.trim(),
      table_sys_id: body.recordSysId.trim(),
      file_name: body.fileName,
    })
    const uploadUrl = `${baseUrl}/api/now/attachment/file?${uploadParams.toString()}`

    const response = await secureFetchWithValidation(
      uploadUrl,
      {
        method: 'POST',
        headers: {
          Authorization: createBasicAuthHeader(body.username, body.password),
          'Content-Type': contentType,
          Accept: 'application/json',
        },
        body: fileBuffer,
      },
      'instanceUrl'
    )

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: { message?: string }
      }
      const errorMessage =
        errorData?.error?.message ??
        `ServiceNow API error: ${response.status} ${response.statusText}`
      logger.error(`[${requestId}] ServiceNow upload attachment failed`, {
        status: response.status,
      })
      return NextResponse.json({ success: false, error: errorMessage }, { status: response.status })
    }

    const data = (await response.json()) as { result?: ServiceNowAttachment }
    const result = data.result

    logger.info(`[${requestId}] File attached to ServiceNow record successfully`, {
      tableName: body.tableName,
      recordSysId: body.recordSysId,
    })

    return NextResponse.json({
      success: true,
      output: {
        attachment: result
          ? {
              sys_id: result.sys_id ?? null,
              file_name: result.file_name ?? null,
              content_type: result.content_type ?? null,
              size_bytes: result.size_bytes ?? null,
              table_name: result.table_name ?? null,
              table_sys_id: result.table_sys_id ?? null,
              download_link: result.download_link ?? null,
            }
          : null,
        metadata: { recordCount: 1 },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading attachment to ServiceNow:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
