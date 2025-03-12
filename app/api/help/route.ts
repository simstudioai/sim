import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console-logger'

const resend = new Resend(process.env.RESEND_API_KEY)
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
    // Handle multipart form data
    const formData = await req.formData()

    // Extract form fields
    const email = formData.get('email') as string
    const subject = formData.get('subject') as string
    const message = formData.get('message') as string
    const type = formData.get('type') as string

    logger.info(`[${requestId}] Processing help request`, {
      type,
      email: email.substring(0, 3) + '***', // Log partial email for privacy
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
      if (key.startsWith('image_') && value instanceof Blob) {
        const file = value as File
        const buffer = Buffer.from(await file.arrayBuffer())

        images.push({
          filename: file.name,
          content: buffer,
          contentType: file.type,
        })
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
    logger.error(`[${requestId}] Error processing help request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
