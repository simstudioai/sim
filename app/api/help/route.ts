import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { z } from 'zod'

const resend = new Resend(process.env.RESEND_API_KEY)

// Define schema for validation
const helpFormSchema = z.object({
  email: z.string().email('Invalid email address'),
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other']),
})

export async function POST(req: NextRequest) {
  try {
    // Handle multipart form data
    const formData = await req.formData()

    // Extract form fields
    const email = formData.get('email') as string
    const subject = formData.get('subject') as string
    const message = formData.get('message') as string
    const type = formData.get('type') as string

    // Validate the form data
    const result = helpFormSchema.safeParse({
      email,
      subject,
      message,
      type,
    })

    if (!result.success) {
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
      console.error('Error sending email:', error)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

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
        // Log but don't fail if confirmation email fails
        console.warn('Failed to send confirmation email:', err)
      })

    return NextResponse.json(
      { success: true, message: 'Help request submitted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error processing help request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
