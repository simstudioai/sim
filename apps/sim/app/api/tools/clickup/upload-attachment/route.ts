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
import { clickupAuthorizationHeader, extractClickUpErrorMessage } from '@/tools/clickup/shared'

export const dynamic = 'force-dynamic'

const logger = createLogger('ClickUpUploadAttachmentAPI')

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

    let buffer: Buffer
    let downloadedContentType = ''
    try {
      const result = await downloadServableFileFromStorage(userFile, requestId, logger)
      buffer = result.buffer
      downloadedContentType = result.contentType
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      throw error
    }

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(buffer)], {
      type: downloadedContentType || userFile.type || 'application/octet-stream',
    })
    formData.append('attachment', blob, userFile.name)

    const url = `https://api.clickup.com/api/v2/task/${encodeURIComponent(params.taskId)}/attachment`
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

    const record = (data ?? {}) as Record<string, unknown>

    return NextResponse.json({
      success: true,
      output: {
        attachment: {
          id: typeof record.id === 'string' ? record.id : '',
          title: typeof record.title === 'string' ? record.title : null,
          extension: typeof record.extension === 'string' ? record.extension : null,
          url: typeof record.url === 'string' ? record.url : null,
          date: typeof record.date === 'number' ? record.date : null,
        },
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
