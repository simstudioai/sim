import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchGetLogEventsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-get-log-events'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, getLogEvents } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchGetLogEvents')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchGetLogEventsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    logger.error('GetLogEvents failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CloudWatch log events: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
