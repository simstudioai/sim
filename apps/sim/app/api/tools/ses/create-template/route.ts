import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, createTemplate } from '../utils'

const logger = createLogger('SESCreateTemplateAPI')

const CreateTemplateSchema = z
  .object({
    region: z
      .string()
      .min(1, 'AWS region is required')
      .refine((v) => validateAwsRegion(v).isValid, {
        message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
      }),
    accessKeyId: z.string().min(1, 'AWS access key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
    templateName: z.string().min(1, 'Template name is required'),
    subjectPart: z.string().min(1, 'Subject is required'),
    textPart: z.string().nullish(),
    htmlPart: z.string().nullish(),
  })
  .refine((data) => data.textPart || data.htmlPart, {
    message: 'At least one of textPart or htmlPart is required',
    path: ['textPart'],
  })

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const params = CreateTemplateSchema.parse(body)

    logger.info(`Creating SES template '${params.templateName}'`)

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createTemplate(client, {
        templateName: params.templateName,
        subjectPart: params.subjectPart,
        textPart: params.textPart,
        htmlPart: params.htmlPart,
      })

      logger.info(`Template '${params.templateName}' created successfully`)

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

    logger.error('Failed to create template:', error)

    return NextResponse.json(
      { error: `Failed to create template: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
