import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { jiraAddAttachmentContract } from '@/lib/api/contracts/selectors/jira'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
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

    const formData = new FormData()

    for (const file of userFiles) {
      const denied = await assertToolFileAccess(file.key, authResult.userId, requestId, logger)
      if (denied) return denied
      const buffer = await downloadFileFromStorage(file, requestId, logger)
      const blob = new Blob([new Uint8Array(buffer)], {
        type: file.type || 'application/octet-stream',
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
