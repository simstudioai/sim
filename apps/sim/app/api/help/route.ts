import { type NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null
const logger = createLogger('HelpAPI')

// Define schema for validation
const helpFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other']),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Check if Resend API key is configured
    if (!resend) {
      logger.error(`[${requestId}] RESEND_API_KEY not configured`)
      return NextResponse.json(
        {
          error:
            'Email service not configured. Please set RESEND_API_KEY in environment variables.',
        },
        { status: 500 }
      )
    }

    // Handle multipart form data
    const formData = await req.formData()

    // Extract form fields
    const email = formData.get('email') as string
    const subject = formData.get('subject') as string
    const message = formData.get('message') as string
    const type = formData.get('type') as string

    logger.info(`[${requestId}] Processing help request`, {
      type,
      email: `${email.substring(0, 3)}***`, // Log partial email for privacy
    })

    // Validate the form data
    const result = helpFormSchema.safeParse({
      email,
      subject,
      message,
      type,
    })

    if (!result.success) {
      logger.warn(`[${requestId}] Invalid help request data`, {
        errors: result.error.format(),
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: result.error.format() },
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

    // Send email using Resend
    const { data, error } = await resend.emails.send({
      from: 'Sim Studio <noreply@simstudio.ai>',
      to: ['help@simstudio.ai'],
      subject: `[${type.toUpperCase()}] ${subject}`,
      replyTo: email,
      text: emailText,
      attachments: images.map((image) => ({
        filename: image.filename,
        content: image.content.toString('base64'),
        contentType: image.contentType,
        disposition: 'attachment', // Explicitly set as attachment
      })),
    })

    if (error) {
      logger.error(`[${requestId}] Error sending help request email`, error)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    logger.info(`[${requestId}] Help request email sent successfully`)

    // Send confirmation email to the user
    await resend.emails
      .send({
        from: 'Sim Studio <noreply@simstudio.ai>',
        to: [email],
        subject: `Your ${type} request has been received: ${subject}`,
        text: `
Hello,

Thank you for your ${type} submission. We've received your request and will get back to you as soon as possible.

Your message:
${message}

${images.length > 0 ? `You attached ${images.length} image(s).` : ''}

Best regards,
The Sim Studio Team
      `,
        replyTo: 'help@simstudio.ai',
      })
      .catch((err) => {
        logger.warn(`[${requestId}] Failed to send confirmation email`, err)
      })

    return NextResponse.json(
      { success: true, message: 'Help request submitted successfully' },
      { status: 200 }
    )
  } catch (error) {
    // Check if error is related to missing API key
    if (error instanceof Error && error.message.includes('API key')) {
      logger.error(`[${requestId}] API key configuration error`, error)
      return NextResponse.json(
        { error: 'Email service configuration error. Please check your RESEND_API_KEY.' },
        { status: 500 }
      )
    }

    logger.error(`[${requestId}] Error processing help request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
