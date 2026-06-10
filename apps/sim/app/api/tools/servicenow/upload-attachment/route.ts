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
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
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

    let fileBuffer: Buffer
    let contentType = 'application/octet-stream'

    if (body.file) {
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

      if (userFile.type) contentType = userFile.type
      fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    } else if (body.fileContent) {
      fileBuffer = Buffer.from(body.fileContent, 'base64')
    } else {
      return NextResponse.json(
        { success: false, error: 'Either file or fileContent must be provided' },
        { status: 400 }
      )
    }

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

    const data = (await response.json()) as { result?: unknown }

    logger.info(`[${requestId}] File attached to ServiceNow record successfully`, {
      tableName: body.tableName,
      recordSysId: body.recordSysId,
    })

    return NextResponse.json({
      success: true,
      output: {
        attachment: data.result,
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
