import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
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

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = GetLogEventsSchema.parse(body)

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

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

    return NextResponse.json({
      success: true,
      output: { events: result.events },
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get CloudWatch log events'
    logger.error('GetLogEvents failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
