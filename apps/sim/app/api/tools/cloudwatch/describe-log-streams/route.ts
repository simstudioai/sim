import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAwsRegion } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, describeLogStreams } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchDescribeLogStreams')

const DescribeLogStreamsSchema = z.object({
  region: z
    .string()
    .min(1, 'AWS region is required')
    .refine((v) => validateAwsRegion(v).isValid, {
      message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
    }),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupName: z.string().min(1, 'Log group name is required'),
  prefix: z.string().optional(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.number({ coerce: true }).int().positive().optional()
  ),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkSessionOrInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = DescribeLogStreamsSchema.parse(body)

    logger.info(`Describing log streams for group: ${validatedData.logGroupName}`)

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await describeLogStreams(client, validatedData.logGroupName, {
        prefix: validatedData.prefix,
        limit: validatedData.limit,
      })

      logger.info(`Successfully described ${result.logStreams.length} log streams`)

      return NextResponse.json({
        success: true,
        output: { logStreams: result.logStreams },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid request data', { errors: error.errors })
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    logger.error('DescribeLogStreams failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to describe CloudWatch log streams: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
