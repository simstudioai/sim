import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, getLogEvents } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchGetLogEvents')

const GetLogEventsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  logGroupName: z.string().min(1, 'Log group name is required'),
  logStreamName: z.string().min(1, 'Log stream name is required'),
  startTime: z.number({ coerce: true }).int().optional(),
  endTime: z.number({ coerce: true }).int().optional(),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.number({ coerce: true }).int().positive().optional()
  ),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = GetLogEventsSchema.parse(body)

    logger.info(
      `Getting log events from ${validatedData.logGroupName}/${validatedData.logStreamName}`
    )

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await getLogEvents(
        client,
        validatedData.logGroupName,
        validatedData.logStreamName,
        {
          startTime: validatedData.startTime,
          endTime: validatedData.endTime,
          limit: validatedData.limit,
        }
      )

      logger.info(`Successfully retrieved ${result.events.length} log events`)

      return NextResponse.json({
        success: true,
        output: { events: result.events },
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
    logger.error('GetLogEvents failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CloudWatch log events: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
