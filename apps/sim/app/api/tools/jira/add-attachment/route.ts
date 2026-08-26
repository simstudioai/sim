import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jiraAddAttachmentContract } from '@/lib/api/contracts/selectors/jira'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateJiraCloudId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'

const logger = createLogger('JiraAddAttachmentAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = `jira-attach-${Date.now()}`

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(jiraAddAttachmentContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const userFiles = processFilesToUserFiles(validatedData.files, requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid files provided for upload' },
        { status: 400 }
      )
    }

    const cloudId =
      validatedData.cloudId ||
      (await getJiraCloudId(validatedData.domain, validatedData.accessToken))

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const issueKeyValidation = validateJiraIssueKey(validatedData.issueKey, 'issueKey')
    if (!issueKeyValidation.isValid) {
      return NextResponse.json({ error: issueKeyValidation.error }, { status: 400 })
    }

    const formData = new FormData()
    // Every attachment lands in the same multipart body, so the ceiling covers the
    // set rather than each file on its own.
    let remainingBytes = MAX_BUFFERED_TRANSFER_BYTES

    for (const file of userFiles) {
      const denied = await assertToolFileAccess(file.key, authResult.userId, requestId, logger)
      if (denied) return denied
      let buffer: Buffer
      let downloadedContentType = ''
      try {
        const result = await downloadServableFileFromStorage(file, requestId, logger, {
          maxBytes: remainingBytes,
        })
        buffer = result.buffer
        downloadedContentType = result.contentType
      } catch (error) {
        const notReady = docNotReadyResponse(error)
        if (notReady) return notReady
        throw error
      }
      remainingBytes -= buffer.length
      const blob = new Blob([new Uint8Array(buffer)], {
        type: downloadedContentType || file.type || 'application/octet-stream',
      })
      formData.append('file', blob, file.name)
    }

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${validatedData.issueKey}/attachments`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'X-Atlassian-Token': 'no-check',
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Jira attachment upload failed`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        {
          success: false,
          error: parseAtlassianErrorMessage(response.status, response.statusText, errorText),
        },
        { status: response.status }
      )
    }

    const jiraAttachments = await response.json()
    const attachmentsList = Array.isArray(jiraAttachments) ? jiraAttachments : []

    const attachmentIds = attachmentsList.map((att: any) => att.id).filter(Boolean)
    const attachments = attachmentsList.map((att: any) => ({
      id: att.id ?? '',
      filename: att.filename ?? '',
      mimeType: att.mimeType ?? '',
      size: att.size ?? 0,
      content: att.content ?? '',
    }))

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: validatedData.issueKey,
        attachments,
        attachmentIds,
        files: userFiles,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Jira attachment upload error`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Internal server error') },
      { status: 500 }
    )
  }
})
