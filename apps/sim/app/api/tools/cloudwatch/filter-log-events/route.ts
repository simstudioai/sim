import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudwatchFilterLogEventsContract } from '@/lib/api/contracts/tools/aws/cloudwatch-filter-log-events'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCloudWatchLogsClient, filterLogEvents } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchFilterLogEvents')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudwatchFilterLogEventsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info(`Filtering log events in ${validatedData.logGroupName}`)

    const client = createCloudWatchLogsClient({
      region: validatedData.region,
      accessKeyId: validatedData.accessKeyId,
      secretAccessKey: validatedData.secretAccessKey,
    })

    try {
      const result = await filterLogEvents(client, validatedData.logGroupName, {
        filterPattern: validatedData.filterPattern,
        logStreamNamePrefix: validatedData.logStreamNamePrefix,
        // CloudWatch Logs timestamps are epoch milliseconds; our params are epoch seconds.
        startTime:
          validatedData.startTime !== undefined ? validatedData.startTime * 1000 : undefined,
        endTime: validatedData.endTime !== undefined ? validatedData.endTime * 1000 : undefined,
        startFromHead: validatedData.startFromHead,
        limit: validatedData.limit,
      })

      logger.info(`Successfully filtered ${result.events.length} log events`)

      return NextResponse.json({
        success: true,
        output: { events: result.events },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('FilterLogEvents failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to filter CloudWatch log events: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
