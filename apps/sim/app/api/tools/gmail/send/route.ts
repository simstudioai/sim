import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { generateRequestId } from '@/lib/utils'
import {
  base64UrlEncode,
  buildMimeMessage,
  buildSimpleEmailMessage,
  fetchThreadingHeaders,
} from '@/tools/gmail/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailSendAPI')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

const GmailSendSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  to: z.string().min(1, 'Recipient email is required'),
  subject: z.string().optional().nullable(),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),
  threadId: z.string().optional().nullable(),
  replyToMessageId: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  attachments: z.array(z.any()).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Gmail send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Gmail send request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = GmailSendSchema.parse(body)

    logger.info(`[${requestId}] Sending Gmail email`, {
      to: validatedData.to,
      subject: validatedData.subject || '',
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
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)

      const attachments = processFilesToUserFiles(rawAttachments, requestId, logger)

      if (attachments.length === 0) {
        logger.warn(`[${requestId}] No valid attachments found after processing`)
      } else {
        const totalSize = attachments.reduce((sum, file) => sum + file.size, 0)
        const maxSize = 25 * 1024 * 1024 // 25MB

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
            try {
              logger.info(
                `[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`
              )

              const buffer = await downloadFileFromStorage(file, requestId, logger)

              return {
                filename: file.name,
                mimeType: file.type || 'application/octet-stream',
                content: buffer,
              }
            } catch (error) {
              logger.error(`[${requestId}] Failed to download attachment ${file.name}:`, error)
              throw new Error(
                `Failed to download attachment "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
              )
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

        logger.info(`[${requestId}] Built MIME message (${mimeMessage.length} bytes)`)
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

    const requestBody: { raw: string; threadId?: string } = { raw: rawMessage }

    if (validatedData.threadId) {
      requestBody.threadId = validatedData.threadId
    }

    const gmailResponse = await fetch(`${GMAIL_API_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

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

    logger.info(`[${requestId}] Email sent successfully`, { messageId: data.id })

    return NextResponse.json({
      success: true,
      output: {
        content: 'Email sent successfully',
        metadata: {
          id: data.id,
          threadId: data.threadId,
          labelIds: data.labelIds,
        },
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error sending Gmail email:`, error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
