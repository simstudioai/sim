import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, sendBulkEmail } from '../utils'

const logger = createLogger('SESSendBulkEmailAPI')

const DestinationSchema = z.object({
  toAddresses: z.array(z.string().email()),
  templateData: z.string().optional(),
})

const SendBulkEmailSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  fromAddress: z.string().email('Valid sender email address is required'),
  templateName: z.string().min(1, 'Template name is required'),
  destinations: z.string().min(1, 'Destinations JSON array is required'),
  defaultTemplateData: z.string().nullish(),
  configurationSetName: z.string().nullish(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = SendBulkEmailSchema.parse(body)

    let destinations: Array<{ toAddresses: string[]; templateData?: string }>
    try {
      const parsed = JSON.parse(params.destinations)
      destinations = z.array(DestinationSchema).parse(parsed)
    } catch {
      return NextResponse.json(
        { error: 'destinations must be a valid JSON array of destination objects' },
        { status: 400 }
      )
    }

    logger.info(
      `Sending bulk email from ${params.fromAddress} to ${destinations.length} destination(s) using template '${params.templateName}'`
    )

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await sendBulkEmail(client, {
        fromAddress: params.fromAddress,
        templateName: params.templateName,
        destinations,
        defaultTemplateData: params.defaultTemplateData,
        configurationSetName: params.configurationSetName,
      })

      logger.info(
        `Bulk email sent: ${result.successCount} succeeded, ${result.failureCount} failed`
      )

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

    logger.error('Failed to send bulk email:', error)

    return NextResponse.json(
      { error: `Failed to send bulk email: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
