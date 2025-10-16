import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { extractStorageKey } from '@/lib/uploads/file-utils'
import { downloadFile } from '@/lib/uploads/storage-client'
import { generateRequestId } from '@/lib/utils'
import { downloadExecutionFile } from '@/lib/workflows/execution-file-storage'
import { isExecutionFile } from '@/lib/workflows/execution-files'
import type { UserFile } from '@/executor/types'
import { base64UrlEncode, buildMimeMessage } from '@/tools/gmail/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GmailSendAPI')

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

const GmailSendSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  to: z.string().min(1, 'Recipient email is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
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
      subject: validatedData.subject,
      hasAttachments: !!(validatedData.attachments && validatedData.attachments.length > 0),
      attachmentCount: validatedData.attachments?.length || 0,
    })

    let rawMessage: string | undefined

    // Check if we have attachments
    if (validatedData.attachments && validatedData.attachments.length > 0) {
      const rawAttachments = validatedData.attachments
      logger.info(`[${requestId}] Processing ${rawAttachments.length} attachment(s)`)

      // Process attachments - convert to UserFile format if needed
      const attachments: UserFile[] = []
      for (const att of rawAttachments) {
        // Already a UserFile (from variable reference like {{gmail_read_1.files}})
        if (att.id && att.key && att.uploadedAt) {
          attachments.push(att as UserFile)
          continue
        }

        // From file-upload sub-block - extract storage key from path
        const storageKey = att.key || (att.path ? extractStorageKey(att.path) : null)

        if (!storageKey) {
          logger.warn(`[${requestId}] Skipping attachment with no key: ${att.name}`)
          continue
        }

        const userFile: UserFile = {
          id: att.id || `file-${Date.now()}`,
          name: att.name,
          url: att.url || att.path,
          size: att.size,
          type: att.type || 'application/octet-stream',
          key: storageKey,
          uploadedAt: att.uploadedAt || new Date().toISOString(),
          expiresAt: att.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }
        logger.info(
          `[${requestId}] Converted to UserFile - name: ${userFile.name}, key: ${userFile.key}`
        )
        attachments.push(userFile)
      }

      if (attachments.length === 0) {
        logger.warn(`[${requestId}] No valid attachments found after processing`)
        // Continue without attachments
      } else {
        // Validate total attachment size (Gmail limit is 25MB)
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

        // Download each attachment from execution storage
        const attachmentBuffers = await Promise.all(
          attachments.map(async (file) => {
            try {
              logger.info(
                `[${requestId}] Downloading attachment: ${file.name} (${file.size} bytes)`
              )

              let buffer: Buffer

              // Use helper to determine storage type
              if (isExecutionFile(file)) {
                logger.info(`[${requestId}] Downloading from execution storage: ${file.key}`)
                buffer = await downloadExecutionFile(file)
              } else if (file.key) {
                logger.info(`[${requestId}] Downloading from regular storage: ${file.key}`)
                buffer = await downloadFile(file.key)
              } else {
                throw new Error('File has no key - cannot download')
              }

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

        // Build MIME message with attachments
        const mimeMessage = buildMimeMessage({
          to: validatedData.to,
          cc: validatedData.cc ?? undefined,
          bcc: validatedData.bcc ?? undefined,
          subject: validatedData.subject,
          body: validatedData.body,
          attachments: attachmentBuffers,
        })

        logger.info(`[${requestId}] Built MIME message (${mimeMessage.length} bytes)`)
        rawMessage = base64UrlEncode(mimeMessage)
      }
    }

    // If no rawMessage was set (no valid attachments), use simple format
    if (!rawMessage) {
      // No attachments - use simple format
      const emailHeaders = [
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `To: ${validatedData.to}`,
      ]

      if (validatedData.cc) {
        emailHeaders.push(`Cc: ${validatedData.cc}`)
      }
      if (validatedData.bcc) {
        emailHeaders.push(`Bcc: ${validatedData.bcc}`)
      }

      emailHeaders.push(`Subject: ${validatedData.subject}`, '', validatedData.body)
      const email = emailHeaders.join('\n')
      rawMessage = Buffer.from(email).toString('base64url')
    }

    // Send email via Gmail API
    const gmailResponse = await fetch(`${GMAIL_API_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawMessage }),
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
