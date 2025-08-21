import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { renderHelpConfirmationEmail } from '@/components/emails'
import { getSession } from '@/lib/auth'
import { sendEmail } from '@/lib/email/mailer'
import { getFromEmailAddress } from '@/lib/email/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getEmailDomain } from '@/lib/urls/utils'

const logger = createLogger('HelpAPI')

const helpFormSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other']),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get user session
    const session = await getSession()
    if (!session?.user?.email) {
      logger.warn(`[${requestId}] Unauthorized help request attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const email = session.user.email

    // Handle multipart form data
    const formData = await req.formData()

    // Extract form fields
    const subject = formData.get('subject') as string
    const message = formData.get('message') as string
    const type = formData.get('type') as string

    logger.info(`[${requestId}] Processing help request`, {
      type,
      email: `${email.substring(0, 3)}***`, // Log partial email for privacy
    })

    // Validate the form data
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

    // Extract images
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

    // Prepare email content
    let emailText = `
Type: ${type}
From: ${email}

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

    // Send confirmation email to the user
    try {
      const confirmationHtml = await renderHelpConfirmationEmail(
        email,
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
