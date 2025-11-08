import { render } from '@react-email/components'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import CareersConfirmationEmail from '@/components/emails/careers-confirmation-email'
import CareersSubmissionEmail from '@/components/emails/careers-submission-email'
import { sendEmail } from '@/lib/email/mailer'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('CareersAPI')

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const CareersSubmissionSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  position: z.string().min(2, 'Please specify the position you are interested in'),
  linkedin: z.string().url('Please enter a valid LinkedIn URL').optional().or(z.literal('')),
  portfolio: z.string().url('Please enter a valid portfolio URL').optional().or(z.literal('')),
  experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+']),
  location: z.string().min(2, 'Please enter your location'),
  message: z.string().min(50, 'Please tell us more about yourself (at least 50 characters)'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const formData = await request.formData()

    const data = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      position: formData.get('position') as string,
      linkedin: formData.get('linkedin') as string,
      portfolio: formData.get('portfolio') as string,
      experience: formData.get('experience') as string,
      location: formData.get('location') as string,
      message: formData.get('message') as string,
    }

    const resumeFile = formData.get('resume') as File | null
    if (!resumeFile) {
      return NextResponse.json(
        {
          success: false,
          message: 'Resume is required',
          errors: [{ path: ['resume'], message: 'Resume is required' }],
        },
        { status: 400 }
      )
    }

    if (resumeFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          message: 'Resume file size must be less than 10MB',
          errors: [{ path: ['resume'], message: 'File size must be less than 10MB' }],
        },
        { status: 400 }
      )
    }

    if (!ALLOWED_FILE_TYPES.includes(resumeFile.type)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Resume must be a PDF or Word document',
          errors: [{ path: ['resume'], message: 'File must be PDF or Word document' }],
        },
        { status: 400 }
      )
    }

    const resumeBuffer = await resumeFile.arrayBuffer()
    const resumeBase64 = Buffer.from(resumeBuffer).toString('base64')

    const validatedData = CareersSubmissionSchema.parse(data)

    logger.info(`[${requestId}] Processing career application`, {
      name: validatedData.name,
      email: validatedData.email,
      position: validatedData.position,
      resumeSize: resumeFile.size,
      resumeType: resumeFile.type,
    })

    const submittedDate = new Date()

    const careersEmailHtml = await render(
      CareersSubmissionEmail({
        name: validatedData.name,
        email: validatedData.email,
        phone: validatedData.phone,
        position: validatedData.position,
        linkedin: validatedData.linkedin,
        portfolio: validatedData.portfolio,
        experience: validatedData.experience,
        location: validatedData.location,
        message: validatedData.message,
        submittedDate,
      })
    )

    const confirmationEmailHtml = await render(
      CareersConfirmationEmail({
        name: validatedData.name,
        position: validatedData.position,
        submittedDate,
      })
    )

    const careersEmailResult = await sendEmail({
      to: 'careers@sim.ai',
      subject: `New Career Application: ${validatedData.name} - ${validatedData.position}`,
      html: careersEmailHtml,
      emailType: 'transactional',
      replyTo: validatedData.email,
      attachments: [
        {
          filename: resumeFile.name,
          content: resumeBase64,
          contentType: resumeFile.type,
        },
      ],
    })

    if (!careersEmailResult.success) {
      logger.error(`[${requestId}] Failed to send email to careers@sim.ai`, {
        error: careersEmailResult.message,
      })
      throw new Error('Failed to submit application')
    }

    const confirmationResult = await sendEmail({
      to: validatedData.email,
      subject: `Your Application to Sim - ${validatedData.position}`,
      html: confirmationEmailHtml,
      emailType: 'transactional',
      replyTo: validatedData.email,
    })

    if (!confirmationResult.success) {
      logger.warn(`[${requestId}] Failed to send confirmation email to applicant`, {
        email: validatedData.email,
        error: confirmationResult.message,
      })
    }

    logger.info(`[${requestId}] Career application submitted successfully`, {
      careersEmailSent: careersEmailResult.success,
      confirmationEmailSent: confirmationResult.success,
    })

    return NextResponse.json({
      success: true,
      message: 'Application submitted successfully',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid application data`, { errors: error.errors })
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid application data',
          errors: error.errors,
        },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error processing career application:`, error)

    return NextResponse.json(
      {
        success: false,
        message:
          'Failed to submit application. Please try again or email us directly at careers@sim.ai',
      },
      { status: 500 }
    )
  }
}
