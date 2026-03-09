import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('SendGridSendMailAPI')

const SendGridSendMailSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  from: z.string().min(1, 'From email is required'),
  fromName: z.string().optional().nullable(),
  to: z.string().min(1, 'To email is required'),
  toName: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  contentType: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  replyToName: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  dynamicTemplateData: z.any().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SendGrid send attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated SendGrid send request via ${authResult.authType}`)

    const body = await request.json()
    const validatedData = SendGridSendMailSchema.parse(body)

    logger.info(`[${requestId}] Sending SendGrid email`, {
      to: validatedData.to,
      subject: validatedData.subject || '(template)',
      hasAttachments: !!(validatedData.attachments && validatedData.attachments.length > 0),
      attachmentCount: validatedData.attachments?.length || 0,
    })

    // Build personalizations
    const personalizations: Record<string, unknown> = {
      to: [
        { email: validatedData.to, ...(validatedData.toName && { name: validatedData.toName }) },
      ],
    }

    if (validatedData.cc) {
      personalizations.cc = [{ email: validatedData.cc }]
    }

    if (validatedData.bcc) {
      personalizations.bcc = [{ email: validatedData.bcc }]
    }

    if (validatedData.templateId && validatedData.dynamicTemplateData) {
      personalizations.dynamic_template_data =
        typeof validatedData.dynamicTemplateData === 'string'
          ? JSON.parse(validatedData.dynamicTemplateData)
          : validatedData.dynamicTemplateData
    }

    // Build mail body
    const mailBody: Record<string, unknown> = {
      personalizations: [personalizations],
      from: {
        email: validatedData.from,
        ...(validatedData.fromName && { name: validatedData.fromName }),
      },
      subject: validatedData.subject,
    }

    if (validatedData.templateId) {
      mailBody.template_id = validatedData.templateId
    } else {
      mailBody.content = [
        {
          type: validatedData.contentType || 'text/plain',
          value: validatedData.content,
        },
      ]
    }

    if (validatedData.replyTo) {
      mailBody.reply_to = {
        email: validatedData.replyTo,
        ...(validatedData.replyToName && { name: validatedData.replyToName }),
      }
    }

    // Process attachments from UserFile objects
    if (validatedData.attachments && validatedData.attachments.length > 0) {
      const rawAttachments = validatedData.attachments
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)

      const userFiles = processFilesToUserFiles(rawAttachments, requestId, logger)

      if (userFiles.length > 0) {
        const sendGridAttachments = await Promise.all(
          userFiles.map(async (file) => {
            try {
              logger.info(
                `[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`
              )
              const buffer = await downloadFileFromStorage(file, requestId, logger)

              return {
                content: buffer.toString('base64'),
                filename: file.name,
                type: file.type || 'application/octet-stream',
                disposition: 'attachment',
              }
            } catch (error) {
              logger.error(`[${requestId}] Failed to download attachment ${file.name}:`, error)
              throw new Error(
                `Failed to download attachment "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
              )
            }
          })
        )

        mailBody.attachments = sendGridAttachments
      }
    }

    // Send to SendGrid
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mailBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage =
        errorData.errors?.[0]?.message || errorData.message || 'Failed to send email'
      logger.error(`[${requestId}] SendGrid API error:`, { status: response.status, errorData })
      return NextResponse.json({ success: false, error: errorMessage }, { status: response.status })
    }

    const messageId = response.headers.get('X-Message-Id')
    logger.info(`[${requestId}] Email sent successfully`, { messageId })

    return NextResponse.json({
      success: true,
      output: {
        success: true,
        messageId: messageId || undefined,
        to: validatedData.to,
        subject: validatedData.subject || '',
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Validation error:`, error.errors)
      return NextResponse.json(
        { success: false, error: error.errors[0]?.message || 'Validation failed' },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Unexpected error:`, error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
