import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { getJiraCloudId } from '@/tools/jira/utils'

const logger = createLogger('JiraAddAttachmentAPI')

export const dynamic = 'force-dynamic'

const JiraAddAttachmentSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  domain: z.string().min(1, 'Domain is required'),
  issueKey: z.string().min(1, 'Issue key is required'),
  files: RawFileInputArraySchema,
  cloudId: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = `jira-attach-${Date.now()}`

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = JiraAddAttachmentSchema.parse(body)

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
    const filesOutput: Array<{ name: string; mimeType: string; data: string; size: number }> = []

    for (const file of userFiles) {
      const buffer = await downloadFileFromStorage(file, requestId, logger)
      filesOutput.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: buffer.length,
      })
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
          error: `Failed to upload attachments: ${response.statusText}`,
        },
        { status: response.status }
      )
    }

    const attachments = await response.json()
    const attachmentIds = Array.isArray(attachments)
      ? attachments.map((attachment) => attachment.id).filter(Boolean)
      : []

    return NextResponse.json({
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: validatedData.issueKey,
        attachmentIds,
        files: filesOutput,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Jira attachment upload error`, error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
