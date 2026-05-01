import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { gmailEditDraftContract } from '@/lib/api/contracts/google-tools'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import {
  base64UrlEncode,
  buildMimeMessage,
  buildSimpleEmailMessage,
  fetchThreadingHeaders,
  GMAIL_API_BASE,
} from '@/tools/gmail/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailEditDraftAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Gmail edit draft attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Gmail edit draft request via ${authResult.authType}`,
      { userId: authResult.userId }
    )

    const parsed = await parseRequest(gmailEditDraftContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`[${requestId}] Updating Gmail draft`, {
      draftId: validatedData.draftId,
      to: validatedData.to,
      hasAttachments: !!(validatedData.attachments && validatedData.attachments.length > 0),
      attachmentCount: validatedData.attachments?.length || 0,
    })

    const threadingHeaders = validatedData.replyToMessageId
      ? await fetchThreadingHeaders(validatedData.replyToMessageId, validatedData.accessToken)
      : {}

    const originalMessageId = threadingHeaders.messageId
    const originalReferences = threadingHeaders.references
    const originalSubject = threadingHeaders.subject

    let rawMessage: string | undefined

    if (validatedData.attachments && validatedData.attachments.length > 0) {
      const rawAttachments = validatedData.attachments
      const attachments = processFilesToUserFiles(rawAttachments, requestId, logger)

      if (attachments.length > 0) {
        const totalSize = attachments.reduce((sum, file) => sum + file.size, 0)
        const maxSize = 25 * 1024 * 1024

        if (totalSize > maxSize) {
          const sizeMB = (totalSize / (1024 * 1024)).toFixed(2)
          return NextResponse.json(
            {
              success: false,
              error: `Total attachment size (${sizeMB}MB) exceeds Gmail's limit of 25MB`,
            },
            { status: 400 }
          )
        }

        const attachmentBuffers = await Promise.all(
          attachments.map(async (file) => {
            const buffer = await downloadFileFromStorage(file, requestId, logger)
            return {
              filename: file.name,
              mimeType: file.type || 'application/octet-stream',
              content: buffer,
            }
          })
        )

        const mimeMessage = buildMimeMessage({
          to: validatedData.to,
          cc: validatedData.cc ?? undefined,
          bcc: validatedData.bcc ?? undefined,
          subject: validatedData.subject || originalSubject || '',
          body: validatedData.body,
          contentType: validatedData.contentType || 'text',
          inReplyTo: originalMessageId,
          references: originalReferences,
          attachments: attachmentBuffers,
        })

        rawMessage = base64UrlEncode(mimeMessage)
      }
    }

    if (!rawMessage) {
      rawMessage = buildSimpleEmailMessage({
        to: validatedData.to,
        cc: validatedData.cc,
        bcc: validatedData.bcc,
        subject: validatedData.subject || originalSubject,
        body: validatedData.body,
        contentType: validatedData.contentType || 'text',
        inReplyTo: originalMessageId,
        references: originalReferences,
      })
    }

    const draftMessage: { raw: string; threadId?: string } = { raw: rawMessage }
    if (validatedData.threadId) {
      draftMessage.threadId = validatedData.threadId
    }

    const gmailResponse = await fetch(
      `${GMAIL_API_BASE}/drafts/${encodeURIComponent(validatedData.draftId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${validatedData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: validatedData.draftId,
          message: draftMessage,
        }),
      }
    )

    if (!gmailResponse.ok) {
      const errorText = await gmailResponse.text()
      logger.error(`[${requestId}] Gmail API error:`, errorText)
      return NextResponse.json(
        {
          success: false,
          error: `Gmail API error: ${gmailResponse.statusText}`,
        },
        { status: gmailResponse.status }
      )
    }

    const data = await gmailResponse.json()

    logger.info(`[${requestId}] Draft updated successfully`, { draftId: data.id })

    return NextResponse.json({
      success: true,
      output: {
        draftId: data.id ?? null,
        messageId: data.message?.id ?? null,
        threadId: data.message?.threadId ?? null,
        labelIds: data.message?.labelIds ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error updating Gmail draft:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
})
