import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { clickupUploadAttachmentContract } from '@/lib/api/contracts/tools/clickup'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpAttachment,
} from '@/tools/clickup/shared'

export const dynamic = 'force-dynamic'

const logger = createLogger('ClickUpUploadAttachmentAPI')

const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024

function uploadSizeError(bytes: number): NextResponse {
  const sizeMB = (bytes / (1024 * 1024)).toFixed(2)
  return NextResponse.json(
    { success: false, error: `File size (${sizeMB}MB) exceeds upload limit of 100MB` },
    { status: 400 }
  )
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(clickupUploadAttachmentContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const userFiles = processFilesToUserFiles([params.file as RawFileInput], requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid file provided for upload' },
        { status: 400 }
      )
    }

    const userFile = userFiles[0]
    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    if (userFile.size > MAX_UPLOAD_SIZE_BYTES) {
      return uploadSizeError(userFile.size)
    }

    let buffer: Buffer
    let downloadedContentType = ''
    try {
      const result = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_UPLOAD_SIZE_BYTES,
      })
      buffer = result.buffer
      downloadedContentType = result.contentType
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      throw error
    }

    if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
      return uploadSizeError(buffer.length)
    }

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(buffer)], {
      type: downloadedContentType || userFile.type || 'application/octet-stream',
    })
    formData.append('attachment', blob, userFile.name)

    const url = `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/attachment`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: clickupAuthorizationHeader(params.accessToken),
      },
      body: formData,
    })

    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = extractClickUpErrorMessage(
        response,
        data,
        'Failed to upload ClickUp attachment'
      )
      logger.error(`[${requestId}] ClickUp attachment upload failed`, {
        status: response.status,
        message,
      })
      return NextResponse.json({ success: false, error: message }, { status: response.status })
    }

    return NextResponse.json({
      success: true,
      output: {
        attachment: mapClickUpAttachment(data),
        files: userFiles,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] ClickUp attachment upload error`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
