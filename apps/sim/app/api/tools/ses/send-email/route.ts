import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, sendEmail } from '../utils'

const logger = createLogger('SESSendEmailAPI')

const SendEmailSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    fromAddress: z.string().email('Valid sender email address is required'),
    toAddresses: z.string().min(1, 'At least one recipient address is required'),
    subject: z.string().min(1, 'Email subject is required'),
    bodyText: z.string().nullish(),
    bodyHtml: z.string().nullish(),
    ccAddresses: z.string().nullish(),
    bccAddresses: z.string().nullish(),
    replyToAddresses: z.string().nullish(),
    configurationSetName: z.string().nullish(),
  })
  .refine((data) => data.bodyText || data.bodyHtml, {
    message: 'At least one of bodyText or bodyHtml is required',
    path: ['bodyText'],
  })

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = SendEmailSchema.parse(body)

    const toList = params.toAddresses
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    logger.info(`Sending email from ${params.fromAddress} to ${toList.length} recipient(s)`)

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendEmail(client, {
        fromAddress: params.fromAddress,
        toAddresses: toList,
        subject: params.subject,
        bodyText: params.bodyText,
        bodyHtml: params.bodyHtml,
        ccAddresses: params.ccAddresses
          ? params.ccAddresses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        bccAddresses: params.bccAddresses
          ? params.bccAddresses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        replyToAddresses: params.replyToAddresses
          ? params.replyToAddresses
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
        configurationSetName: params.configurationSetName,
      })

      logger.info(`Email sent successfully, messageId: ${result.messageId}`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to send email:', error)

    return NextResponse.json(
      { error: `Failed to send email: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
