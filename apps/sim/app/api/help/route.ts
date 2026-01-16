import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { renderHelpConfirmationEmail } from '@/components/emails'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'
import { getEmailDomain } from '@/lib/core/utils/urls'
import { sendEmail } from '@/lib/messaging/email/mailer'
import { getFromEmailAddress } from '@/lib/messaging/email/utils'

const logger = createLogger('HelpAPI')

const helpFormSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other']),
})

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.email) {
      logger.warn(`[${requestId}] Unauthorized help request attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const email = session.user.email

    const formData = await req.formData()

    const subject = formData.get('subject') as string
    const message = formData.get('message') as string
    const type = formData.get('type') as string
    const workflowId = formData.get('workflowId') as string | null
    const workspaceId = formData.get('workspaceId') as string
    const userAgent = formData.get('userAgent') as string | null

    logger.info(`[${requestId}] Processing help request`, {
      type,
      email: `${email.substring(0, 3)}***`, // Log partial email for privacy
    })

    const validationResult = helpFormSchema.safeParse({
      subject,
      message,
      type,
    })

    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid help request data`, {
        errors: validationResult.error.format(),
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: validationResult.error.format() },
        { status: 400 }
      )
    }

    const images: { filename: string; content: Buffer; contentType: string }[] = []

    for (const [key, value] of formData.entries()) {
      if (key.startsWith('image_') && typeof value !== 'string') {
        if (value && 'arrayBuffer' in value) {
          const blob = value as unknown as Blob
          const buffer = Buffer.from(await blob.arrayBuffer())
          const filename = 'name' in value ? (value as any).name : `image_${key.split('_')[1]}`

          images.push({
            filename,
            content: buffer,
            contentType: 'type' in value ? (value as any).type : 'application/octet-stream',
          })
        }
      }
    }

    logger.debug(`[${requestId}] Help request includes ${images.length} images`)

    const userId = session.user.id
    let emailText = `
Type: ${type}
From: ${email}
User ID: ${userId}
Workspace ID: ${workspaceId ?? 'N/A'}
Workflow ID: ${workflowId ?? 'N/A'}
Browser: ${userAgent ?? 'N/A'}

${message}
    `

    if (images.length > 0) {
      emailText += `\n\n${images.length} image(s) attached.`
    }

    const emailResult = await sendEmail({
      to: [`help@${env.EMAIL_DOMAIN || getEmailDomain()}`],
      subject: `[${type.toUpperCase()}] ${subject}`,
      text: emailText,
      from: getFromEmailAddress(),
      replyTo: email,
      emailType: 'transactional',
      attachments: images.map((image) => ({
        filename: image.filename,
        content: image.content.toString('base64'),
        contentType: image.contentType,
        disposition: 'attachment',
      })),
    })

    if (!emailResult.success) {
      logger.error(`[${requestId}] Error sending help request email`, emailResult.message)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    logger.info(`[${requestId}] Help request email sent successfully`)

    try {
      const confirmationHtml = await renderHelpConfirmationEmail(
        type as 'bug' | 'feedback' | 'feature_request' | 'other',
        images.length
      )

      await sendEmail({
        to: [email],
        subject: `Your ${type} request has been received: ${subject}`,
        html: confirmationHtml,
        from: getFromEmailAddress(),
        replyTo: `help@${env.EMAIL_DOMAIN || getEmailDomain()}`,
        emailType: 'transactional',
      })
    } catch (err) {
      logger.warn(`[${requestId}] Failed to send confirmation email`, err)
    }

    return NextResponse.json(
      { success: true, message: 'Help request submitted successfully' },
      { status: 200 }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      logger.error(`[${requestId}] Email service configuration error`, error)
      return NextResponse.json(
        {
          error:
            'Email service configuration error. Please check your email service configuration.',
        },
        { status: 500 }
      )
    }

    logger.error(`[${requestId}] Error processing help request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
