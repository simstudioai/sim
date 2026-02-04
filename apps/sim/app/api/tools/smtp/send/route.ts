import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('SmtpSendAPI')

const SmtpSendSchema = z.object({
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.number().min(1).max(65535, 'Port must be between 1 and 65535'),
  smtpUsername: z.string().min(1, 'SMTP username is required'),
  smtpPassword: z.string().min(1, 'SMTP password is required'),
  smtpSecure: z.enum(['TLS', 'SSL', 'None']),

  from: z.string().email('Invalid from email address').min(1, 'From address is required'),
  to: z.string().min(1, 'To email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  contentType: z.enum(['text', 'html']).optional().nullable(),

  fromName: z.string().optional().nullable(),
  cc: z.string().optional().nullable(),
  bcc: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  attachments: RawFileInputArraySchema.optional().nullable(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SMTP send attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated SMTP request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const validatedData = SmtpSendSchema.parse(body)

    logger.info(`[${requestId}] Sending email via SMTP`, {
      host: validatedData.smtpHost,
      port: validatedData.smtpPort,
      to: validatedData.to,
      subject: validatedData.subject,
      secure: validatedData.smtpSecure,
    })

    const transporter = nodemailer.createTransport({
      host: validatedData.smtpHost,
      port: validatedData.smtpPort,
      secure: validatedData.smtpSecure === 'SSL',
      auth: {
        user: validatedData.smtpUsername,
        pass: validatedData.smtpPassword,
      },
      tls:
        validatedData.smtpSecure === 'None'
          ? {
              rejectUnauthorized: false,
            }
          : {
              rejectUnauthorized: true,
            },
    })

    const contentType = validatedData.contentType || 'text'
    const fromAddress = validatedData.fromName
      ? `"${validatedData.fromName}" <${validatedData.from}>`
      : validatedData.from

    const mailOptions: nodemailer.SendMailOptions = {
      from: fromAddress,
      to: validatedData.to,
      subject: validatedData.subject,
      [contentType === 'html' ? 'html' : 'text']: validatedData.body,
    }

    if (validatedData.cc) {
      mailOptions.cc = validatedData.cc
    }
    if (validatedData.bcc) {
      mailOptions.bcc = validatedData.bcc
    }
    if (validatedData.replyTo) {
      mailOptions.replyTo = validatedData.replyTo
    }

    if (validatedData.attachments && validatedData.attachments.length > 0) {
      const rawAttachments = validatedData.attachments
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)

      const attachments = processFilesToUserFiles(rawAttachments, requestId, logger)

      if (attachments.length > 0) {
        const totalSize = attachments.reduce((sum, file) => sum + file.size, 0)
        const maxSize = 25 * 1024 * 1024

        if (totalSize > maxSize) {
          const sizeMB = (totalSize / (1024 * 1024)).toFixed(2)
          return NextResponse.json(
            {
              success: false,
              error: `Total attachment size (${sizeMB}MB) exceeds SMTP limit of 25MB`,
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
                content: buffer,
                contentType: file.type || 'application/octet-stream',
              }
            } catch (error) {
              logger.error(`[${requestId}] Failed to download attachment ${file.name}:`, error)
              throw new Error(
                `Failed to download attachment "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
              )
            }
          })
        )

        logger.info(`[${requestId}] Processed ${attachmentBuffers.length} attachment(s)`)
        mailOptions.attachments = attachmentBuffers
      }
    }

    const result = await transporter.sendMail(mailOptions)

    logger.info(`[${requestId}] Email sent successfully via SMTP`, {
      messageId: result.messageId,
      to: validatedData.to,
    })

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      to: validatedData.to,
      subject: validatedData.subject,
    })
  } catch (error: unknown) {
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

    // Type guard for error objects with code property
    const isNodeError = (err: unknown): err is NodeJS.ErrnoException => {
      return err instanceof Error && 'code' in err
    }

    let errorMessage = 'Failed to send email via SMTP'

    if (isNodeError(error)) {
      if (error.code === 'EAUTH') {
        errorMessage = 'SMTP authentication failed - check username and password'
      } else if (error.code === 'ECONNECTION' || error.code === 'ECONNREFUSED') {
        errorMessage = 'Could not connect to SMTP server - check host and port'
      } else if (error.code === 'ECONNRESET') {
        errorMessage = 'Connection was reset by SMTP server'
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = 'SMTP server connection timeout'
      }
    }

    // Check for SMTP response codes
    const hasResponseCode = (err: unknown): err is { responseCode: number } => {
      return typeof err === 'object' && err !== null && 'responseCode' in err
    }

    if (hasResponseCode(error)) {
      if (error.responseCode >= 500) {
        errorMessage = 'SMTP server error - please try again later'
      } else if (error.responseCode >= 400) {
        errorMessage = 'Email rejected by SMTP server - check recipient addresses'
      }
    }

    logger.error(`[${requestId}] Error sending email via SMTP:`, {
      error: error instanceof Error ? error.message : String(error),
      code: isNodeError(error) ? error.code : undefined,
      responseCode: hasResponseCode(error) ? error.responseCode : undefined,
    })

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    )
  }
}
