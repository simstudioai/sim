import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, sendTemplatedEmail } from '../utils'

const logger = createLogger('SESSendTemplatedEmailAPI')

const SendTemplatedEmailSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  fromAddress: z.string().email('Valid sender email address is required'),
  toAddresses: z.string().min(1, 'At least one recipient address is required'),
  templateName: z.string().min(1, 'Template name is required'),
  templateData: z.string().min(1, 'Template data is required'),
  ccAddresses: z.string().nullish(),
  bccAddresses: z.string().nullish(),
  configurationSetName: z.string().nullish(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = SendTemplatedEmailSchema.parse(body)

    const toList = params.toAddresses
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    logger.info(
      `Sending templated email from ${params.fromAddress} using template '${params.templateName}'`
    )

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendTemplatedEmail(client, {
        fromAddress: params.fromAddress,
        toAddresses: toList,
        templateName: params.templateName,
        templateData: params.templateData,
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
        configurationSetName: params.configurationSetName,
      })

      logger.info(`Templated email sent successfully, messageId: ${result.messageId}`)

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

    logger.error('Failed to send templated email:', error)

    return NextResponse.json(
      { error: `Failed to send templated email: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
